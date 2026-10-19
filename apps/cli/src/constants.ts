import path from "node:path";
import { fileURLToPath } from "node:url";

import { getUserPkgManager } from "./utils/get-package-manager";

// Re-export from template-generator (single source of truth)
export {
  dependencyVersionMap,
  type AvailableDependencies,
} from "@xstack/template-generator";

const __filename = fileURLToPath(import.meta.url);
const distPath = path.dirname(__filename);
export const PKG_ROOT = path.join(distPath, "../");

export const DEFAULT_CONFIG_BASE = {
  projectName: "my-better-t-app",
  relativePath: "my-better-t-app",
  frontend: ["next"],
  database: "sqlite",
  orm: "drizzle",
  addons: ["turborepo"],
  git: true,
  install: true,
  dbSetup: "none",
  backend: "self",
  runtime: "none",
  api: "none",
  webDeploy: "none",
  serverDeploy: "none",
} as const;

export function getDefaultConfig() {
  return {
    ...DEFAULT_CONFIG_BASE,
    projectDir: path.resolve(process.cwd(), DEFAULT_CONFIG_BASE.projectName),
    packageManager: getUserPkgManager(),
    frontend: [...DEFAULT_CONFIG_BASE.frontend],
    addons: [...DEFAULT_CONFIG_BASE.addons],
  };
}

export const DEFAULT_CONFIG = getDefaultConfig();

export { desktopWebFrontends } from "@xstack/types";

export { ADDON_COMPATIBILITY } from "@xstack/types";
