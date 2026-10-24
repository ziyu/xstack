import type { ProjectConfig } from "@xstack/types";

import type { VirtualFileSystem } from "../core/virtual-fs";
import { hasTemplatesWithPrefix, processTemplatesFromPrefix } from "../template-handlers/utils";
import { GeneratorError } from "../types";
import {
  readApplicationCatalog,
  readFrameworkCatalog,
  type ResolvedApplicationAdapter,
} from "./plan";

export function renderApplicationLayers(
  vfs: VirtualFileSystem,
  templates: Map<string, string>,
  config: ProjectConfig,
  adapter: ResolvedApplicationAdapter,
) {
  for (const layer of adapter.layers) {
    if (!hasTemplatesWithPrefix(templates, layer.source)) {
      throw new GeneratorError({
        phase: "applications",
        message: `Application adapter contribution "${layer.source}" is missing`,
      });
    }
    processTemplatesFromPrefix(vfs, templates, layer.source, layer.target, config);
  }
}

export function renderCatalogApplication(
  vfs: VirtualFileSystem,
  templates: Map<string, string>,
  config: ProjectConfig,
  type: string,
  framework: string,
) {
  const manifest = readApplicationCatalog(templates).get(type);
  const adapter = readFrameworkCatalog(templates).get(framework)?.apps[type];
  if (!manifest || !adapter) {
    throw new GeneratorError({
      phase: "applications",
      message: `Framework "${framework}" does not provide application type "${type}"`,
    });
  }
  renderApplicationLayers(vfs, templates, config, adapter);
}
