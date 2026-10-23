import { Result } from "better-result";

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
import type { GeneratorOptions, VirtualFileTree } from "./types";
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
      const { templates } = options;
      const config = toRenderConfig(options.config);

      if (!templates || templates.size === 0) {
        throw new GeneratorError({
          message: "No templates provided. Templates must be passed via the templates option.",
          phase: "initialization",
        });
      }

      const vfs = new VirtualFileSystem();

      await processBaseTemplate(vfs, templates, config);
      await processFrontendTemplates(vfs, templates, config);
      await processBackendTemplates(vfs, templates, config);
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
      processCatalogs(vfs, config);
      processVercelConfig(vfs, config);
      processReadme(vfs, config);

      // Write xstack.jsonc config file
      if (options.version) {
        const reproducibleCommand = generateReproducibleCommand(config);
        writeXStackConfigToVfs(vfs, config, options.version, reproducibleCommand);
      }
      processAgentGuidance(vfs, config);

      const tree: VirtualFileTree = {
        root: vfs.toTree(config.projectName),
        fileCount: vfs.getFileCount(),
        directoryCount: vfs.getDirectoryCount(),
        config,
      };

      return tree;
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
