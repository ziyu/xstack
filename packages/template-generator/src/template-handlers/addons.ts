import { appOutputPath, type ApplicationConfig } from "../contributions/context";
import type { VirtualFileSystem } from "../core/virtual-fs";
import { type TemplateData, processTemplatesFromPrefix } from "./utils";

export async function processAddonTemplates(
  vfs: VirtualFileSystem,
  templates: TemplateData,
  config: ApplicationConfig,
): Promise<void> {
  if (!config.addons || config.addons.length === 0) return;

  for (const addon of config.addons) {
    if (addon === "none") continue;

    // Task runners are handled programmatically by generators.
    if (addon === "turborepo" || addon === "nx" || addon === "vite-plus") continue;
    if (config.application && addon === "electrobun") continue; // Workspace finalizer owns the desktop package.

    if (addon === "pwa") {
      if (
        config.frontend.some((frontend) => ["solid", "react-router", "next"].includes(frontend))
      ) {
        processTemplatesFromPrefix(
          vfs,
          templates,
          "addons/pwa/apps/fullstack-web/ssr",
          appOutputPath(config, "web"),
          config,
        );
      }
      if (config.frontend.includes("next")) {
        processTemplatesFromPrefix(
          vfs,
          templates,
          "addons/pwa/apps/fullstack-web/next",
          appOutputPath(config, "web"),
          config,
        );
      } else if (
        config.frontend.some((f) => ["tanstack-router", "react-router", "solid"].includes(f))
      ) {
        processTemplatesFromPrefix(
          vfs,
          templates,
          "addons/pwa/apps/fullstack-web/vite",
          appOutputPath(config, "web"),
          config,
        );
      }
      continue;
    }

    processTemplatesFromPrefix(vfs, templates, `addons/${addon}`, "", config);
  }
}
