import type { ProjectConfig } from "@xstack/types";

import { requireApplicationPlan, resolveApplicationConfig } from "../apps/config";
import type { ResolvedApplication } from "../apps/plan";
import { processTemplateString, transformFilename } from "../core/template-processor";
import { supportsNativeSplit } from "../modules/native-split";
import { getModulePlan, toRenderConfig } from "../modules/pipeline";
import { GeneratorError, type ApplicationRenderContext } from "../types";
import { resolveApplicationContext } from "./context";

export interface WorkspaceApplication {
  app: ResolvedApplication;
  config: ProjectConfig;
  context: ApplicationRenderContext;
}

/** Every shared output has one owner before any application is rendered. */
export interface WorkspacePlan {
  config: ProjectConfig;
  applications: WorkspaceApplication[];
  rootOwner: string;
  packageOwners: ReadonlyMap<string, string>;
  /** Exact decisions override the root default; keys are physical output paths. */
  rootFileOwners: ReadonlyMap<string, string>;
  ownerOf: (path: string) => string | undefined;
}

export function buildWorkspacePlan(
  input: ProjectConfig,
  templates: Map<string, string>,
): WorkspacePlan {
  const selections = [...(input.apps ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  const config = resolveApplicationConfig({ ...input, apps: selections }, templates);
  const resolved = requireApplicationPlan(config, templates);
  const remaining = [...resolved.apps].sort(
    (a, b) =>
      Number(b.manifest.roles.includes("backend")) - Number(a.manifest.roles.includes("backend")) ||
      a.selection.id.localeCompare(b.selection.id),
  );
  const ordered: ResolvedApplication[] = [];
  const visited = new Set<string>();
  while (remaining.length) {
    const index = remaining.findIndex((app) =>
      Object.values(app.bindings).every((id) => visited.has(id)),
    );
    if (index < 0)
      throw new GeneratorError({
        phase: "ownership",
        message: "Application ownership has a dependency cycle",
      });
    const [app] = remaining.splice(index, 1);
    ordered.push(app!);
    visited.add(app!.selection.id);
  }
  const rootOwner = (ordered.find((app) => app.manifest.roles.includes("backend")) ?? ordered[0])!
    .selection.id;
  const serverOwner = rootOwner;
  const webApps = ordered
    .filter((app) => app.manifest.roles.some((role) => role === "web-frontend" || role === "admin"))
    .sort(
      (a, b) =>
        Number(a.manifest.roles.includes("admin")) - Number(b.manifest.roles.includes("admin")) ||
        a.selection.id.localeCompare(b.selection.id),
    );
  const portOrder = [
    ...ordered.filter((app) => app.manifest.roles.includes("backend")),
    ...webApps.filter((app) => !app.manifest.roles.includes("backend")),
    ...ordered.filter((app) => !app.manifest.roles.includes("backend") && !webApps.includes(app)),
  ];
  const firstApp = portOrder[0]!;
  const basePort = webApps.includes(firstApp) ? 3001 : 3000;
  const ports = new Map(portOrder.map((app, index) => [app.selection.id, basePort + index]));
  const clientOrigins = webApps.map((app) => `http://localhost:${ports.get(app.selection.id)}`);
  const workspaceApplications = ordered.map((app) => {
    const local = resolveApplicationContext(config, app);
    return {
      id: app.selection.id,
      type: app.selection.type,
      roles: app.manifest.roles,
      directory: `apps/${app.selection.id}`,
      port: ports.get(app.selection.id)!,
      origin: `http://localhost:${ports.get(app.selection.id)!}`,
      bindings: app.bindings,
      backendRoot: app.manifest.roles.includes("backend")
        ? `apps/${app.selection.id}`
        : app.bindings.backend
          ? `apps/${app.bindings.backend}`
          : undefined,
      frontend: local.frontend,
      backend: local.backend,
      runtime: local.runtime,
      api: local.api,
      webDeploy: local.webDeploy,
      serverDeploy: local.serverDeploy,
    };
  });
  const packageOwners = new Map<string, string>([
    ["config", rootOwner],
    ["db", serverOwner],
    ["api", serverOwner],
    ["auth", serverOwner],
    ["backend", serverOwner],
    ["infra", rootOwner],
    ...(config.addons.includes("electrobun") ? [["desktop", rootOwner] as [string, string]] : []),
    ...ordered
      .flatMap((app) =>
        app.adapter.sharedPackages.map((name) => [name, app.selection.id] as [string, string]),
      )
      .reverse(),
  ]);
  for (const module of getModulePlan(config, templates).modules) {
    for (const spec of module.manifest.packages ?? []) packageOwners.set(spec.dir, serverOwner);
  }
  const rootFileOwners = new Map<string, string>();
  for (const path of templates.keys()) {
    if (path.startsWith("base/")) rootFileOwners.set(transformFilename(path.slice(5)), rootOwner);
  }
  for (const path of [
    "README.md",
    "AGENTS.md",
    "applications.json",
    "xstack.jsonc",
    "bunfig.toml",
    "turbo.json",
    "pnpm-workspace.yaml",
    ".agents/skills/xstack-project/SKILL.md",
  ]) {
    rootFileOwners.set(path, rootOwner);
  }
  const ownerOf = (path: string): string | undefined => {
    const app = /^apps\/([^/]+)(?:\/|$)/.exec(path);
    if (app) return visited.has(app[1]!) ? app[1] : undefined;
    const pkg = /^packages\/([^/]+)(?:\/|$)/.exec(path);
    if (pkg) return packageOwners.get(pkg[1]!);
    return rootFileOwners.get(path) ?? rootOwner;
  };
  const applications = ordered.map((app): WorkspaceApplication => {
    const appConfig = resolveApplicationContext(config, app);
    const nativeSplit = supportsNativeSplit(appConfig);
    const targetRoot = `apps/${app.selection.id}`;
    const paths: ApplicationRenderContext["paths"] = { [`apps/${app.selection.type}`]: targetRoot };
    for (const role of app.manifest.roles) paths[`apps/${role}`] = targetRoot;
    if (app.bindings.backend) paths["apps/backend"] = `apps/${app.bindings.backend}`;
    if (
      app.adapter.stack.frontend?.some(
        (frontend) => frontend !== "none" && !frontend.startsWith("native-"),
      )
    )
      paths["apps/web"] = targetRoot;
    if (app.manifest.roles.includes("backend")) paths["apps/server"] = targetRoot;
    const context: ApplicationRenderContext = {
      id: app.selection.id,
      type: app.selection.type,
      roles: app.manifest.roles,
      contribution: nativeSplit ? app.adapter.productContribution : undefined,
      clientContributions: app.adapter.clientContributions,
      backendApiPrefix:
        ordered.find(
          (candidate) => candidate.selection.id === (app.bindings.backend ?? app.selection.id),
        )?.adapter.serverContributions?.apiPrefix ?? "",
      workspaceApplications,
      directory: targetRoot,
      origin: `http://localhost:${ports.get(app.selection.id)!}`,
      devArgs: app.adapter.devArgs,
      paths,
      port: ports.get(app.selection.id)!,
      clientOrigins,
      nativeSplit,
      backendOrigin: `http://localhost:${ports.get(app.bindings.backend ?? app.selection.id)!}`,
      workspaceRuntime: config.runtime,
      backendRoot: app.manifest.roles.includes("backend")
        ? targetRoot
        : app.bindings.backend
          ? `apps/${app.bindings.backend}`
          : undefined,
      ownsPath: (path) => ownerOf(path) === app.selection.id,
    };
    return { app, config: appConfig, context };
  });
  // Framework workspace-relative contributions are declarations, not first-wins writes.
  const sharedDefinitions = new Map<
    string,
    { content: string; owner: string; declarers: Set<string> }
  >();
  for (const entry of applications) {
    const renderConfig = { ...toRenderConfig(entry.config, templates), application: entry.context };
    for (const layer of entry.app.adapter.layers) {
      if (layer.target !== "") continue;
      for (const [source, template] of templates) {
        if (!source.startsWith(`${layer.source}/`)) continue;
        const path = transformFilename(source.slice(layer.source.length + 1));
        const content = source.endsWith(".hbs")
          ? processTemplateString(template, renderConfig)
          : template;
        const previous = sharedDefinitions.get(path);
        if (previous && previous.content !== content)
          throw new GeneratorError({
            phase: "ownership",
            message: `Applications ${previous.owner} and ${entry.app.selection.id} declare conflicting shared definitions for ${path}`,
          });
        if (previous) {
          previous.declarers.add(entry.app.selection.id);
          continue;
        }
        sharedDefinitions.set(path, {
          content,
          owner: entry.app.selection.id,
          declarers: new Set([entry.app.selection.id]),
        });
        const pkg = /^packages\/([^/]+)\//.exec(path);
        if (pkg) {
          if (!packageOwners.has(pkg[1]!)) packageOwners.set(pkg[1]!, entry.app.selection.id);
        } else if (!path.startsWith("apps/")) rootFileOwners.set(path, entry.app.selection.id);
      }
    }
  }
  for (const [path, definition] of sharedDefinitions) {
    const owner = ownerOf(path);
    if (!owner || !definition.declarers.has(owner))
      throw new GeneratorError({
        phase: "ownership",
        message: `Shared definition ${path} is not declared by its planned owner ${owner ?? "undeclared"}; shared packages require one complete compatible implementation`,
      });
  }
  return { config, applications, rootOwner, packageOwners, rootFileOwners, ownerOf };
}
