import path from "node:path";

import { Result } from "better-result";
import fs from "fs-extra";

import type { ProjectConfig } from "../../types";
import { addPackageDependency } from "../../utils/add-package-deps";
import { addEnvVariablesToFile, type EnvVariable } from "../../utils/env-utils";
import { DatabaseSetupError } from "../../utils/errors";
import { resolveDatabaseApplication } from "../workspace-applications";

export async function setupCloudflareD1(
  config: ProjectConfig,
): Promise<Result<void, DatabaseSetupError>> {
  const { projectDir, serverDeploy, webDeploy, orm, backend } = config;

  const isCloudflareD1Target =
    orm === "prisma" &&
    (serverDeploy === "cloudflare" || (backend === "self" && webDeploy === "cloudflare"));

  if (!isCloudflareD1Target) {
    return Result.ok(undefined);
  }

  const application = await resolveDatabaseApplication(config, "d1");
  if (application.isErr()) return Result.err(application.error);
  const targetApp = application.value.directory;

  return Result.tryPromise({
    try: async () => {
      const serverDir = path.join(projectDir, targetApp);
      const envPath = path.join(projectDir, targetApp, ".env");
      const variables: EnvVariable[] = [
        {
          key: "DATABASE_URL",
          // Prisma resolves this URL from packages/db, where its config lives.
          // D1 runtime access uses the DB binding; this file is tooling-only.
          value: "file:./local.db",
          condition: true,
        },
      ];

      await addEnvVariablesToFile(envPath, variables);
      // Prisma 7's SQLite schema engine expects the file to exist before the
      // first `migrate dev` run. Keep it beside prisma.config.ts.
      await fs.ensureFile(path.join(projectDir, "packages/db/local.db"));

      await addPackageDependency({
        dependencies: ["@prisma/adapter-d1"],
        projectDir: serverDir,
      });
    },
    catch: (e) =>
      new DatabaseSetupError({
        provider: "d1",
        message: `Failed to set up Cloudflare D1: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      }),
  });
}
