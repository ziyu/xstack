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
  );
  await processBaseTemplate(vfs, templates, config);
  if (app) {
    renderApplicationLayers(vfs, templates, config, app.adapter);
  } else {
    await processFrontendTemplates(vfs, templates, config);
    await processBackendTemplates(vfs, templates, config);
  }
  await processDbTemplates(vfs, templates, config);
  await processApiTemplates(vfs, templates, config);
  await processConfigPackage(vfs, templates, config);
  await processUiPackage(vfs, templates, config);
  await processStackModules(vfs, templates, config);
  await processAddonTemplates(vfs, templates, config);
  await processExtrasTemplates(vfs, templates, config);
  await processDeployTemplates(vfs, templates, config);
  processModuleTemplates(vfs, templates, config);
  processPackageConfigs(vfs, config);
  processDependencies(vfs, config);
  finalizeAlchemyDevScripts(vfs, config);
  processEnvVariables(vfs, config);
  processModuleEnv(vfs, config);
  processAuthPlugins(vfs, config);
  processAlchemyPlugins(vfs, config);
  processPwaPlugins(vfs, config);
  processVarlock(vfs, templates, config);
  finalizeModules(vfs, config);
  if (!app) processCatalogs(vfs, config);
  processVercelConfig(vfs, config);
  if (vfs.ownsPath("package.json")) {
    processReadme(vfs, config);
    if (options.version)
      writeXStackConfigToVfs(vfs, config, options.version, generateReproducibleCommand(config));
    processAgentGuidance(vfs, config);
  }
  return {
    root: vfs.toTree(config.projectName),
    fileCount: vfs.getFileCount(),
    directoryCount: vfs.getDirectoryCount(),
    config,
  };
}
