import { parse, stringify } from "yaml";

import { appOutputPath, type ApplicationConfig } from "../contributions/context";
import type { VirtualFileSystem } from "../core/virtual-fs";
import { addPackageDependency, type AvailableDependencies } from "../utils/add-deps";

export function processEnvDeps(vfs: VirtualFileSystem, config: ApplicationConfig): void {
  addPackageDependency({ vfs, packagePath: "package.json", devDependencies: ["varlock"] });
  for (const app of ["web", "server", "native"] as const) {
    if (config.application) {
      if (app === "server" && !config.application.roles.includes("backend")) continue;
      if (
        app === "web" &&
        !config.frontend.some((frontend) => frontend !== "none" && !frontend.startsWith("native-"))
      )
        continue;
      if (app === "native" && !config.frontend.some((frontend) => frontend.startsWith("native-")))
        continue;
    }
    const packagePath = appOutputPath(config, app, "package.json");
    if (!vfs.ownsPath(packagePath) || !vfs.exists(packagePath)) continue;
    if (
      app === "server" &&
      config.frontend.some((frontend) => frontend !== "none" && !frontend.startsWith("native-")) &&
      packagePath === appOutputPath(config, "web", "package.json")
    )
      continue;
    const dependencies: AvailableDependencies[] = ["varlock"];
    if (app === "web" && config.webDeploy !== "cloudflare") {
      dependencies.push(
        config.frontend.includes("next")
          ? "@varlock/nextjs-integration"
          : config.frontend.includes("nuxt")
            ? "@varlock/nuxt-integration"
            : config.frontend.includes("astro")
              ? "@varlock/astro-integration"
              : "@varlock/vite-integration",
      );
    }
    if (app === "web" && config.webDeploy === "cloudflare" && config.frontend.includes("next"))
      dependencies.push("@opennextjs/cloudflare");
    if (app === "native") {
      dependencies.push("@varlock/expo-integration");
      addPackageDependency({
        vfs,
        packagePath,
        devDependencies: ["babel-preset-expo"],
      });
    }
    addPackageDependency({ vfs, packagePath, dependencies });
  }
  if (config.application?.type === "cli") {
    addPackageDependency({
      vfs,
      packagePath: `${config.application.directory}/package.json`,
      dependencies: ["varlock"],
    });
  }
  if (
    vfs.ownsPath("package.json") &&
    config.frontend.includes("next") &&
    config.webDeploy !== "cloudflare"
  ) {
    const version = "npm:@varlock/nextjs-integration@1.2.2";
    if (config.packageManager === "pnpm") {
      const path = "pnpm-workspace.yaml";
      const workspace = parse(vfs.readFile(path) ?? "") ?? {};
      workspace.overrides = { ...workspace.overrides, "@next/env": version };
      vfs.writeFile(path, stringify(workspace));
    } else {
      const pkg = vfs.readJson<{ overrides?: Record<string, string> }>("package.json")!;
      pkg.overrides = { ...pkg.overrides, "@next/env": version };
      vfs.writeJson("package.json", pkg);
    }
  }
}
