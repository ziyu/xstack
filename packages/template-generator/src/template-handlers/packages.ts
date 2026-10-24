import type { ProjectConfig } from "@xstack/types";

import type { VirtualFileSystem } from "../core/virtual-fs";
import type { RenderConfig } from "../types";
import { type TemplateData, processTemplatesFromPrefix } from "./utils";

export async function processConfigPackage(
  vfs: VirtualFileSystem,
  templates: TemplateData,
  config: ProjectConfig & Pick<RenderConfig, "application">,
): Promise<void> {
  const workspaceConfig = config.application
    ? { ...config, runtime: config.application.workspaceRuntime }
    : config;
  processTemplatesFromPrefix(vfs, templates, "packages/config", "packages/config", workspaceConfig);
}

export async function processUiPackage(
  vfs: VirtualFileSystem,
  templates: TemplateData,
  config: ProjectConfig,
): Promise<void> {
  const hasReactWeb = config.frontend.some((f) =>
    ["tanstack-router", "react-router", "tanstack-start", "next"].includes(f),
  );

  if (!hasReactWeb) return;

  processTemplatesFromPrefix(vfs, templates, "packages/ui", "packages/ui", config);
}
