import type { ProjectConfig } from "@xstack/types";

import { renderCatalogApplication } from "../apps/render";
import type { VirtualFileSystem } from "../core/virtual-fs";
import { GeneratorError } from "../types";
import type { TemplateData } from "./utils";

export async function processFrontendTemplates(
  vfs: VirtualFileSystem,
  templates: TemplateData,
  config: ProjectConfig,
): Promise<void> {
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
