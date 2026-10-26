import type { ProjectConfig } from "@xstack/types";

import { appOutputPath } from "../contributions/context";
import type { VirtualFileSystem } from "../core/virtual-fs";
import { addPackageDependency } from "../utils/add-deps";

export function processFrontendDeps(vfs: VirtualFileSystem, config: ProjectConfig): void {
  const { addons, frontend, webDeploy } = config;

  if (
    !frontend.includes("astro") ||
    addons.includes("electrobun") ||
    addons.includes("tauri") ||
    webDeploy === "cloudflare" ||
    webDeploy === "prisma" ||
    webDeploy === "vercel"
  ) {
    return;
  }

  const webPackagePath = appOutputPath(config, "web", "package.json");
  if (!vfs.ownsPath(webPackagePath) || !vfs.exists(webPackagePath)) return;

  addPackageDependency({
    vfs,
    packagePath: webPackagePath,
    dependencies: ["@astrojs/node"],
  });
}
