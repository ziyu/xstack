import path from "node:path";

import { Result } from "better-result";
import fs from "fs-extra";
import z from "zod";

import { readXStackConfig } from "../../utils/xstack-config";

const packageIdentitySchema = z.object({ name: z.string().optional() });

export async function detectProjectConfig(projectDir: string) {
  projectDir = path.resolve(projectDir);
  const result = await Result.tryPromise({
    try: async () => {
      const xstackConfig = await readXStackConfig(projectDir);
      if (xstackConfig) {
        // Workspace imports keep their original scope even if the folder is renamed.
        const configPackagePath = path.join(projectDir, "packages/config/package.json");
        const configPackage = (await fs.pathExists(configPackagePath))
          ? packageIdentitySchema.parse(await fs.readJson(configPackagePath))
          : undefined;
        const rootPackagePath = path.join(projectDir, "package.json");
        const rootPackage = (await fs.pathExists(rootPackagePath))
          ? packageIdentitySchema.parse(await fs.readJson(rootPackagePath))
          : undefined;
        const scope = configPackage?.name
          ? /^@([^/]+)\/config$/.exec(configPackage.name)?.[1]
          : undefined;
        return {
          projectDir,
          projectName: scope || rootPackage?.name || path.basename(projectDir),
          addonOptions: xstackConfig.addonOptions,
          dbSetupOptions: xstackConfig.dbSetupOptions,
          database: xstackConfig.database,
          orm: xstackConfig.orm,
          backend: xstackConfig.backend,
          runtime: xstackConfig.runtime,
          frontend: xstackConfig.frontend,
          addons: xstackConfig.addons,
          product: xstackConfig.product,
          packageManager: xstackConfig.packageManager,
          dbSetup: xstackConfig.dbSetup,
          api: xstackConfig.api,
          webDeploy: xstackConfig.webDeploy,
          serverDeploy: xstackConfig.serverDeploy,
        };
      }

      return null;
    },
    catch: () => null,
  });

  return result.isOk() ? result.value : null;
}

export async function isXStackProject(projectDir: string): Promise<boolean> {
  const result = await Result.tryPromise({
    try: () => fs.pathExists(path.join(projectDir, "xstack.jsonc")),
    catch: () => false,
  });

  return result.isOk() ? result.value : false;
}
