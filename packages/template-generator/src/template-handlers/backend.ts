import { renderCatalogApplication } from "../apps/render";
import type { ApplicationConfig } from "../contributions/context";
import type { VirtualFileSystem } from "../core/virtual-fs";
import { type TemplateData, processTemplatesFromPrefix } from "./utils";

export async function processBackendTemplates(
  vfs: VirtualFileSystem,
  templates: TemplateData,
  config: ApplicationConfig,
): Promise<void> {
  if (config.application && !config.application.roles.includes("backend")) return;
  if (config.backend === "none") return;

  if (config.backend === "convex") {
    processTemplatesFromPrefix(
      vfs,
      templates,
      "backend/convex/packages/backend",
      "packages/backend",
      config,
    );
    return;
  }

  if (config.backend === "self") return;

  renderCatalogApplication(
    vfs,
    templates,
    config,
    config.application?.type ?? "backend",
    config.backend,
  );
}
