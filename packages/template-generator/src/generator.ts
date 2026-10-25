import { Result } from "better-result";

import { generateApplications } from "./apps/generate";
import type { ResolvedApplication } from "./apps/plan";
import { renderApplicationLayers } from "./apps/render";
import { resolveWorkspaceCapabilities } from "./contributions/capabilities";
import { assertContributionInventory } from "./contributions/inventory";
import { planStackContributions } from "./contributions/preflight";
import { VirtualFileSystem } from "./core/virtual-fs";
import {
  finalizeModules,
  processModuleEnv,
  processModuleTemplates,
  processStackModules,
  toRenderConfig,
} from "./modules/pipeline";
import {
  finalizeAlchemyDevScripts,
  processCatalogs,
  processPackageConfigs,
  processVercelConfig,
} from "./post-process";
import {
  processDependencies,
  processReadme,
  processAuthPlugins,
  processAlchemyPlugins,
  processPwaPlugins,
  processEnvVariables,
} from "./processors";
import { processAgentGuidance } from "./processors/agent-guidance";
import { processVarlock } from "./processors/varlock";
import {
  type TemplateData,
  processBaseTemplate,
  processFrontendTemplates,
  processBackendTemplates,
  processDbTemplates,
  processApiTemplates,
  processConfigPackage,
  processUiPackage,
  processAddonTemplates,
  processExtrasTemplates,
  processDeployTemplates,
} from "./template-handlers";
import type {
  ApplicationRenderContext,
  GeneratorOptions,
  RenderConfig,
  VirtualFileTree,
} from "./types";
import { GeneratorError } from "./types";
import { generateReproducibleCommand } from "./utils/reproducible-command";
import { writeXStackConfigToVfs } from "./xstack-config";

export type { TemplateData };

/**
 * Generates a virtual project file tree from templates and configuration.
 * Returns a Result type for type-safe error handling.
 *
 * @example
 * ```typescript
 * const result = await generate(options);
 * result.match({
 *   ok: (tree) => console.log(`Generated ${tree.fileCount} files`),
 *   err: (error) => console.error(`Failed: ${error.message}`),
 * });
 * ```
 */
export async function generate(
  options: GeneratorOptions,
): Promise<Result<VirtualFileTree, GeneratorError>> {
  return Result.tryPromise({
    try: async () => {
      if (options.templates) assertContributionInventory(options.templates);
      if (options.config.apps) {
        const capabilities = resolveWorkspaceCapabilities(options.config, options.templates);
        if (capabilities.issues.length)
          throw new GeneratorError({
            phase: "contributions",
            message: capabilities.issues.join("; "),
          });
      }
      if (options.templates) planStackContributions(options.config, options.templates);
      if (options.config.apps) return generateApplications(options, generateApplication);
      return generateApplication(options);
    },
    catch: (e) => {
      if (GeneratorError.is(e)) {
        return e;
      }
      return new GeneratorError({
        message: e instanceof Error ? e.message : String(e),
        phase: "unknown",
        cause: e,
      });
    },
  });
}

async function generateApplication(
  options: GeneratorOptions,
  app?: ResolvedApplication,
  context?: ApplicationRenderContext,
): Promise<VirtualFileTree> {
  const { templates } = options;
  if (!templates || templates.size === 0) {
    throw new GeneratorError({
      message: "No templates provided. Templates must be passed via the templates option.",
      phase: "initialization",
    });
  }
  const config: RenderConfig = toRenderConfig(options.config);
  config.application = context;
  const vfs = new VirtualFileSystem(
    context?.paths ?? {
      "apps/fullstack-web": "apps/web",
      "apps/web-frontend": "apps/web",
      "apps/backend": "apps/server",
    },
    context ? { ownsPath: context.ownsPath, inheritedFiles: context.inheritedFiles } : undefined,
    {
      trace: options.trace,
      source: { kind: "processor", name: "application", app: context?.id, owner: context?.id },
    },
  );
  const stage = <T>(name: string, run: () => T): T =>
    vfs.withSource({ kind: "processor", name }, run);
  const asyncStage = <T>(name: string, run: () => Promise<T>): Promise<T> =>
    vfs.withSourceAsync({ kind: "processor", name }, run);
  await asyncStage("base", () => processBaseTemplate(vfs, templates, config));
  if (app) {
    stage("application-layers", () => renderApplicationLayers(vfs, templates, config, app.adapter));
  } else {
    await asyncStage("frontend", () => processFrontendTemplates(vfs, templates, config));
    await asyncStage("backend", () => processBackendTemplates(vfs, templates, config));
  }
  await asyncStage("database", () => processDbTemplates(vfs, templates, config));
  await asyncStage("api", () => processApiTemplates(vfs, templates, config));
  await asyncStage("config-package", () => processConfigPackage(vfs, templates, config));
  await asyncStage("ui-package", () => processUiPackage(vfs, templates, config));
  await asyncStage("stack-modules", () => processStackModules(vfs, templates, config));
  await asyncStage("addons", () => processAddonTemplates(vfs, templates, config));
  await asyncStage("extras", () => processExtrasTemplates(vfs, templates, config));
  await asyncStage("deploy", () => processDeployTemplates(vfs, templates, config));
  stage("module-templates", () => processModuleTemplates(vfs, templates, config));
  stage("package-configs", () => processPackageConfigs(vfs, config));
  stage("dependencies", () => processDependencies(vfs, config));
  stage("alchemy-dev-scripts", () => finalizeAlchemyDevScripts(vfs, config));
  stage("environment", () => processEnvVariables(vfs, config));
  stage("module-environment", () => processModuleEnv(vfs, config));
  stage("auth-plugins", () => processAuthPlugins(vfs, config));
  stage("alchemy-plugins", () => processAlchemyPlugins(vfs, config));
  stage("pwa-plugins", () => processPwaPlugins(vfs, config));
  stage("varlock", () => processVarlock(vfs, templates, config));
  stage("module-finalization", () => finalizeModules(vfs, config));
  if (!app) stage("catalogs", () => processCatalogs(vfs, config));
  stage("vercel-config", () => processVercelConfig(vfs, config));
  if (vfs.ownsPath("package.json")) {
    stage("readme", () => processReadme(vfs, config));
    if (options.version)
      stage("saved-config", () =>
        writeXStackConfigToVfs(vfs, config, options.version!, generateReproducibleCommand(config)),
      );
    stage("agent-guidance", () => processAgentGuidance(vfs, config));
  }
  const tree: VirtualFileTree = {
    root: vfs.toTree(config.projectName),
    fileCount: vfs.getFileCount(),
    directoryCount: vfs.getDirectoryCount(),
    config,
  };
  if (options.trace) tree.provenance = vfs.getProvenance();
  return tree;
}
