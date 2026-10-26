import { renderCatalogApplication } from "../apps/render";
import type { VirtualFileSystem } from "../core/virtual-fs";
import { GeneratorError, type RenderConfig } from "../types";
import type { TemplateData } from "./utils";

export async function processFrontendTemplates(
  vfs: VirtualFileSystem,
  templates: TemplateData,
  config: RenderConfig,
): Promise<void> {
  if (config.application) {
    const selected = config.frontend.filter((frontend) => frontend !== "none");
    if (selected.length !== 1) {
      throw new GeneratorError({
        phase: "applications",
        message: `Application ${config.application.id} must select exactly one frontend implementation`,
      });
    }
    renderCatalogApplication(vfs, templates, config, config.application.type, selected[0]!);
    return;
  }
  const web = config.frontend.filter(
    (frontend) => frontend !== "none" && !frontend.startsWith("native-"),
  );
  const native = config.frontend.filter((frontend) => frontend.startsWith("native-"));
  if (web.length > 1 || native.length > 1) {
    throw new GeneratorError({
      phase: "applications",
      message:
        "Multiple frontend implementations require explicit application instances; each application selects one template.",
    });
  }
  for (const frontend of web) {
    renderCatalogApplication(
      vfs,
      templates,
      config,
      config.backend === "self" ? "fullstack-web" : "web-frontend",
      frontend,
    );
  }
  for (const frontend of native) {
    renderCatalogApplication(vfs, templates, config, "native", frontend);
  }
}
