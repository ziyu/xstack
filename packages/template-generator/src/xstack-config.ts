import type { XStackConfig, ProjectConfig } from "@xstack/types";

import type { VirtualFileSystem } from "./core/virtual-fs";

const XSTACK_CONFIG_FILE = "xstack.jsonc";

/**
 * Writes the XSTACK configuration file to the VFS (for new project creation).
 * This is browser-safe as it only writes to VFS, not the real filesystem.
 */
export function writeXStackConfigToVfs(
  vfs: VirtualFileSystem,
  projectConfig: ProjectConfig,
  version: string,
  reproducibleCommand?: string,
): void {
  const xstackConfig: XStackConfig = {
    version,
    createdAt: new Date().toISOString(),
    reproducibleCommand,
    addonOptions: projectConfig.addonOptions,
    dbSetupOptions: projectConfig.dbSetupOptions,
    database: projectConfig.database,
    orm: projectConfig.orm,
    backend: projectConfig.backend,
    runtime: projectConfig.runtime,
    frontend: projectConfig.frontend,
    addons: projectConfig.addons,
    packageManager: projectConfig.packageManager,
    dbSetup: projectConfig.dbSetup,
    api: projectConfig.api,
    webDeploy: projectConfig.webDeploy,
    serverDeploy: projectConfig.serverDeploy,
    product: projectConfig.product,
  };

  const baseContent = {
    $schema: "https://r2.xstack.dev/schema.json",
    ...xstackConfig,
  };

  const jsonContent = JSON.stringify(baseContent, null, 2);

  const addCommand =
    projectConfig.packageManager === "npm"
      ? "npx xstack@latest add"
      : projectConfig.packageManager === "pnpm"
        ? "pnpm dlx xstack@latest add"
        : "bunx xstack@latest add";

  const finalContent = `// xstack project metadata
//
// Keep this file to use the \`add\` command.
// Add addons: ${addCommand}
//
// Docs: https://xstack.dev/docs
// Stack Builder: https://xstack.dev/new

${jsonContent}`;

  vfs.writeFile(XSTACK_CONFIG_FILE, finalContent);
}
