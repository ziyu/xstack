import type { ProjectConfig } from "@xstack/types";

import { buildWorkspacePlan } from "../contributions/workspace";
import { VirtualFileSystem } from "../core/virtual-fs";
import { toRenderConfig } from "../modules/pipeline";
import { processCatalogs } from "../post-process/catalogs";
import { updateRootPackageJson, processNpmScriptApprovals } from "../post-process/package-configs";
import { processAddonsDeps } from "../processors/addons-deps";
import { processAgentGuidance } from "../processors/agent-guidance";
import { processEnvDeps } from "../processors/env-deps";
import { processTurboConfig } from "../processors/turbo-generator";
import { processWorkspaceDeps } from "../processors/workspace-deps";
import {
  GeneratorError,
  type ApplicationRenderContext,
  type GeneratorOptions,
  type VirtualFileTree,
  type VirtualNode,
} from "../types";
import { generateReproducibleCommand } from "../utils/reproducible-command";
import { writeXStackConfigToVfs } from "../xstack-config";
import type { ResolvedApplication } from "./plan";

type PackageJson = {
  name?: string;
  scripts?: Record<string, string>;
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
  const plan = buildWorkspacePlan(options.config, templates);
  const { config } = plan;
  const vfs = new VirtualFileSystem({}, undefined, {
    trace: options.trace,
    source: { kind: "processor", name: "workspace", owner: plan.rootOwner },
  });
  const stage = <T>(name: string, run: () => T): T =>
    vfs.withSource({ kind: "processor", name }, run);
  for (const entry of plan.applications) {
    const { app, context } = entry;
    // Only manifests of already-generated shared packages are inherited. App files
    // and package implementations are never visible to another application's processors.
    context.inheritedFiles = new Map(
      vfs
        .getAllFiles()
        .filter((path) => path === "package.json" || /^packages\/[^/]+\/package\.json$/.test(path))
        .filter(
          (path) =>
            app.manifest.scope !== "independent" ||
            path === "package.json" ||
            path === "packages/config/package.json",
        )
        .map((path) => [path, vfs.readFile(path)!]),
    );
    const tree = await render({ ...options, config: entry.config }, app, context);
    for (const file of flatten(tree.root)) {
      const owner = plan.ownerOf(file.path);
      if (owner !== app.selection.id)
        throw new GeneratorError({
          phase: "ownership",
          message: `Application ${app.selection.id} wrote unplanned shared file ${file.path}; owner is ${owner ?? "undeclared"}`,
        });
      if (vfs.fileExists(file.path))
        throw new GeneratorError({
          phase: "ownership",
          message: `Shared file ${file.path} was rendered more than once`,
        });
      vfs.withoutTracing(() => vfs.writeFile(file.path, file.content, file.sourcePath));
    }
    if (tree.provenance) vfs.importProvenance(tree.provenance);
    const packagePath = `apps/${app.selection.id}/package.json`;
    const pkg = vfs.readJson<PackageJson>(packagePath);
    if (!pkg)
      throw new GeneratorError({
        phase: "applications",
        message: `Application ${app.selection.id} does not provide package.json`,
      });
    pkg.name = app.selection.id;
    vfs.withSource(
      {
        kind: "processor",
        name: "application-package-name",
        app: app.selection.id,
        owner: app.selection.id,
      },
      () => vfs.writeJson(packagePath, pkg),
    );
  }

  // Root dependencies are contributions from every app, not the root owner's stack.
  // Reuse dependency processors in an explicitly root-owned view; shared packages
  // have already been rendered and must not be processed again under another stack.
  for (const entry of plan.applications) {
    const rootView = new VirtualFileSystem(
      entry.context.paths,
      {
        ownsPath: (path) => !path.startsWith("apps/") && !path.startsWith("packages/"),
        inheritedFiles: new Map(
          vfs
            .getAllFiles()
            .filter((path) => path.endsWith("/package.json"))
            .map((path) => [path, vfs.readFile(path)!]),
        ),
      },
      {
        trace: options.trace,
        source: {
          kind: "processor",
          name: "workspace-dependencies",
          app: entry.app.selection.id,
          owner: plan.rootOwner,
        },
      },
    );
    for (const path of ["package.json", "pnpm-workspace.yaml"]) {
      const content = vfs.readFile(path);
      if (content !== undefined) rootView.withoutTracing(() => rootView.writeFile(path, content));
    }
    const renderConfig = toRenderConfig(entry.config);
    renderConfig.application = entry.context;
    if (options.trace)
      rootView.importProvenance(
        vfs
          .getProvenance()
          .filter(
            (record) => record.path === "package.json" || record.path === "pnpm-workspace.yaml",
          ),
      );
    const inheritedTraceLength = rootView.getProvenance().length;
    rootView.withSource({ kind: "processor", name: "workspace-dependencies" }, () =>
      processWorkspaceDeps(rootView, renderConfig),
    );
    rootView.withSource({ kind: "processor", name: "workspace-environment-dependencies" }, () =>
      processEnvDeps(rootView, renderConfig),
    );
    rootView.withSource({ kind: "processor", name: "workspace-addon-dependencies" }, () =>
      processAddonsDeps(rootView, renderConfig),
    );
    rootView.withSource({ kind: "processor", name: "workspace-script-approvals" }, () =>
      processNpmScriptApprovals(rootView, renderConfig),
    );
    for (const path of rootView.getAllFiles())
      vfs.withoutTracing(() => vfs.writeFile(path, rootView.readFile(path)!));
    if (options.trace) vfs.importProvenance(rootView.getProvenance().slice(inheritedTraceLength));
  }
  const aggregateConfig: ProjectConfig = {
    ...config,
    frontend: [...new Set(plan.applications.flatMap((entry) => entry.config.frontend))].filter(
      (frontend) => frontend !== "none",
    ),
  };
  const rootConfig = toRenderConfig(aggregateConfig);
  rootConfig.application = plan.applications.find(
    (entry) => entry.app.selection.id === plan.rootOwner,
  )!.context;
  stage("workspace-package-config", () => updateRootPackageJson(vfs, rootConfig));
  stage("workspace-turbo", () => processTurboConfig(vfs, aggregateConfig));
  const root = vfs.readJson<PackageJson>("package.json");
  if (!root)
    throw new GeneratorError({ phase: "applications", message: "Missing workspace package.json" });
  root.scripts ??= {};
  for (const key of Object.keys(root.scripts))
    if (key.startsWith("dev:") && key !== "dev:setup") delete root.scripts[key];
  for (const { app } of plan.applications) {
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
    const existing = (root.scripts.postinstall ?? "")
      .split(" && ")
      .filter((command) => command && !command.startsWith("varlock codegen --path "));
    root.scripts.postinstall = [...existing, ...envCommands].join(" && ");
  }
  stage("workspace-commands", () => vfs.writeJson("package.json", root));
  stage("workspace-catalogs", () => processCatalogs(vfs, config));
  stage("application-inventory", () =>
    vfs.writeJson(
      "applications.json",
      plan.applications.map(({ app }) => ({
        id: app.selection.id,
        type: app.selection.type,
        stack: app.selection.stack,
        roles: app.manifest.roles,
        product: app.product ?? null,
        bindings: app.bindings,
      })),
    ),
  );
  if (options.version)
    stage("workspace-saved-config", () =>
      writeXStackConfigToVfs(vfs, config, options.version!, generateReproducibleCommand(config)),
    );
  stage("workspace-readme", () =>
    vfs.writeFile(
      "README.md",
      `# ${config.projectName}\n\n## Applications\n\n${plan.applications.map(({ app }) => `- \`apps/${app.selection.id}\`: ${app.manifest.name} (${app.manifest.roles.join(", ") || "independent"}). Run \`${config.packageManager} run dev:${app.selection.id}\`.`).join("\n")}\n\nApplication ownership and resolved connections: \`applications.json\`.\n`,
    ),
  );
  stage("workspace-agent-guidance", () => processAgentGuidance(vfs, config));
  const tree: VirtualFileTree = {
    root: vfs.toTree(config.projectName),
    fileCount: vfs.getFileCount(),
    directoryCount: vfs.getDirectoryCount(),
    config,
  };
  if (options.trace) tree.provenance = vfs.getProvenance();
  return tree;
}
