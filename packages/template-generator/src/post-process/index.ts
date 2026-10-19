/**
 * Post-processor - Orchestrates post-generation processing
 * Modifies virtual files after template generation
 */

import type { VirtualFileSystem } from "../core/virtual-fs";
import type { RenderConfig } from "../types";
import { processCatalogs } from "./catalogs";
import { finalizeAlchemyDevScripts, processPackageConfigs } from "./package-configs";
import { processVercelConfig } from "./vercel-config";

/**
 * Run all post-processing steps on the virtual filesystem
 */
export function processPostGeneration(vfs: VirtualFileSystem, config: RenderConfig) {
  processPackageConfigs(vfs, config);
  processCatalogs(vfs, config);
  processVercelConfig(vfs, config);
}

export { finalizeAlchemyDevScripts, processCatalogs, processPackageConfigs, processVercelConfig };
