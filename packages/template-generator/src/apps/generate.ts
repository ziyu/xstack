import type { ProjectConfig } from "@xstack/types";

import { VirtualFileSystem } from "../core/virtual-fs";
import { processCatalogs } from "../post-process/catalogs";
import { processAgentGuidance } from "../processors/agent-guidance";
import {
  GeneratorError,
  type ApplicationRenderContext,
  type GeneratorOptions,
  type VirtualFileTree,
  type VirtualNode,
} from "../types";
import { generateReproducibleCommand } from "../utils/reproducible-command";
import { writeXStackConfigToVfs } from "../xstack-config";
import { requireApplicationPlan, resolveApplicationConfig } from "./config";
import type { ResolvedApplication } from "./plan";

type PackageJson = {
  name?: string;
  scripts?: Record<string, string>;
  bin?: Record<string, string>;
};
type RenderApplication = (
  options: GeneratorOptions,
  app: ResolvedApplication,
  context: ApplicationRenderContext,
) => Promise<VirtualFileTree>;

function flatten(node: VirtualNode): Extract<VirtualNode, { type: "file" }>[] {
  return node.type === "file" ? [node] : node.children.flatMap(flatten);
}

export async function generateApplications(
  options: GeneratorOptions,
  render: RenderApplication,
): Promise<VirtualFileTree> {
  const templates = options.templates;
  if (!templates)
    throw new GeneratorError({
      phase: "applications",
      message: "Application templates are required",
    });
  const config = resolveApplicationConfig(options.config, templates);
  const plan = requireApplicationPlan(config, templates);
  if (!plan.apps.length)
    throw new GeneratorError({ phase: "applications", message: "Select at least one application" });
  const vfs = new VirtualFileSystem();
  const productApps = plan.apps
    .filter((app) => app.manifest.scope === "product")
    .sort(
      (a, b) =>
        Number(b.manifest.roles.includes("backend")) - Number(a.manifest.roles.includes("backend")),
    );
  const independentApps = plan.apps.filter((app) => app.manifest.scope === "independent");
  const webApps = productApps.filter(
    (app) => app.manifest.roles.includes("web-frontend") || app.manifest.roles.includes("admin"),
  );
  const ports = new Map(webApps.map((app, index) => [app.selection.id, 3001 + index]));
  const clientOrigins = webApps.map((app) => `http://localhost:${ports.get(app.selection.id)}`);
  let hasRoot = false;
  for (const app of [...productApps, ...independentApps]) {
    const appConfig: ProjectConfig = {
      ...config,
      apps: undefined,
      ...app.adapter.stack,
      frontend: app.adapter.stack.frontend ?? ["none"],
      api:
        app.manifest.scope === "product" && !app.manifest.roles.includes("backend")
          ? config.api
          : (app.adapter.stack.api ?? config.api),
    };
    const independent = app.manifest.scope === "independent";
    if (independent) {
      appConfig.frontend = app.adapter.stack.frontend ?? ["none"];
      appConfig.backend = app.adapter.stack.backend ?? "none";
      appConfig.runtime = app.adapter.stack.runtime ?? "none";
      appConfig.api = app.adapter.stack.api ?? "none";
      appConfig.database = "none";
      appConfig.orm = "none";
      appConfig.product = { features: [] };
    }
    const targetRoot = `apps/${app.selection.id}`;
    const paths: ApplicationRenderContext["paths"] = { [`apps/${app.selection.type}`]: targetRoot };
    if (
      app.adapter.stack.frontend?.some(
        (frontend) => frontend !== "none" && !frontend.startsWith("native-"),
      )
    ) {
      paths["apps/web"] = targetRoot;
    }
    if (app.selection.type === "backend") paths["apps/server"] = targetRoot;
    const tree = await render({ ...options, config: appConfig }, app, {
      id: app.selection.id,
      type: app.selection.type,
      paths,
      port: ports.get(app.selection.id) ?? 3000,
      clientOrigins,
      workspaceRuntime: config.runtime,
    });
    for (const file of flatten(tree.root)) {
      const { path, content } = file;
      const appFile = path.startsWith(`${targetRoot}/`);
      if (path.startsWith("apps/") && !appFile) {
        throw new GeneratorError({
          phase: "applications",
          message: `Application ${app.selection.id} wrote outside its selected application root: ${path}`,
        });
      }
      if (!appFile && hasRoot && !path.startsWith("packages/")) continue;
      const existing = vfs.readFile(path);
      if (independent && !appFile && existing !== undefined) continue;
      const servicePackage = /^packages\/(db|api|auth)\//.test(path);
      if (
        !appFile &&
        existing !== undefined &&
        servicePackage &&
        !app.manifest.roles.includes("backend")
      )
        continue;
      if (existing !== undefined && existing !== content) {
        throw new GeneratorError({
          phase: "applications",
          message: `Applications disagree on shared file ${path}; shared packages must have one compatible implementation`,
        });
      }
      vfs.writeFile(path, content, file.sourcePath);
    }
    const packagePath = `${targetRoot}/package.json`;
    const pkg = vfs.readJson<PackageJson>(packagePath);
    if (!pkg)
      throw new GeneratorError({
        phase: "applications",
        message: `Application ${app.selection.id} does not provide package.json`,
      });
    pkg.name = app.selection.id;
    vfs.writeJson(packagePath, pkg);
    hasRoot = true;
  }
  const root = vfs.readJson<PackageJson>("package.json");
  if (!root)
    throw new GeneratorError({ phase: "applications", message: "Missing workspace package.json" });
  root.scripts ??= {};
  for (const key of Object.keys(root.scripts)) if (key.startsWith("dev:")) delete root.scripts[key];
  for (const app of plan.apps) {
    const pkg = vfs.readJson<PackageJson>(`apps/${app.selection.id}/package.json`)!;
    if (pkg.scripts?.dev) {
      const id = app.selection.id;
      root.scripts[`dev:${id}`] =
        config.packageManager === "npm"
          ? `npm run dev --workspace=${id}`
          : `${config.packageManager} run --filter ${id} dev`;
    }
  }
  const envCommands = vfs
    .getAllFiles()
    .filter((path) => path.endsWith("/.env.schema"))
    .map((path) => `varlock codegen --path ./${path.slice(0, -".env.schema".length)}`);
  if (envCommands.length) {
    root.scripts["env:generate"] = envCommands.join(" && ");
    root.scripts.postinstall = envCommands.join(" && ");
  }
  vfs.writeJson("package.json", root);
  processCatalogs(vfs, config);
  const applications = plan.apps.map((app) => ({
    id: app.selection.id,
    type: app.selection.type,
    stack: app.selection.stack,
    roles: app.manifest.roles,
    product: app.product ?? null,
    bindings: app.bindings,
  }));
  vfs.writeJson("applications.json", applications);
  if (options.version)
    writeXStackConfigToVfs(vfs, config, options.version, generateReproducibleCommand(config));
  vfs.writeFile(
    "README.md",
    `# ${config.projectName}\n\n## Applications\n\n${plan.apps.map((app) => `- \`apps/${app.selection.id}\`: ${app.manifest.name} (${app.manifest.roles.join(", ") || "independent"}). Run \`${config.packageManager} run dev:${app.selection.id}\`.`).join("\n")}\n\nApplication ownership and resolved connections: \`applications.json\`.\n`,
  );
  processAgentGuidance(vfs, config);
  return {
    root: vfs.toTree(config.projectName),
    fileCount: vfs.getFileCount(),
    directoryCount: vfs.getDirectoryCount(),
    config,
  };
}
