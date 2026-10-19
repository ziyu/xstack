import type { ModuleManifest } from "./types";

export function defineModule<const T extends ModuleManifest>(manifest: T): T {
  return manifest;
}
