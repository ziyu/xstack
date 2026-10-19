import { Database } from "bun:sqlite";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RenderConfig } from "@xstack/template-generator";
import { expect } from "@playwright/test";
import { SQL } from "bun";
import { z } from "zod";

import type { Commands } from "./command";

export async function generatePrismaClient(config: RenderConfig, commands: Commands) {
  await commands.run(
    "prisma-generate",
    path.join(config.projectDir, "packages/db"),
    config.packageManager,
    ["run", "db:generate"],
  );
}

export async function generateDatabaseMigrations(config: RenderConfig, commands: Commands) {
  const directory = path.join(config.projectDir, "packages/db");
  if (config.orm === "prisma") {
    await generatePrismaClient(config, commands);
    const sql = await commands.run("migration-generate", directory, "node", [
      "node_modules/prisma/build/index.js",
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema",
      "prisma/schema",
      "--script",
    ]);
    const migrations = path.join(directory, "prisma/migrations");
    await mkdir(path.join(migrations, "0_init"), { recursive: true });
    await writeFile(path.join(migrations, "0_init/migration.sql"), sql);
    await writeFile(
      path.join(migrations, "migration_lock.toml"),
      `provider = "${config.database === "postgres" ? "postgresql" : config.database}"\n`,
    );
  } else {
    await commands.run("migration-generate", directory, config.packageManager, [
      "run",
      "db:generate",
    ]);
  }
}

export async function migrateDatabase(config: RenderConfig, commands: Commands) {
  await generateDatabaseMigrations(config, commands);
  const directory = path.join(config.projectDir, "packages/db");
  for (const step of ["apply", "repeat"])
    await commands.run(`migration-${step}`, directory, config.packageManager, [
      "run",
      "db:migrate:deploy",
    ]);
  await commands.run("database-push", directory, config.packageManager, ["run", "db:push"]);
}

export class DatabaseAssertions {
  private sqlite?: Database;
  private postgres?: SQL;
  constructor(url: string) {
    if (url.startsWith("file:")) this.sqlite = new Database(url.slice(5), { readonly: true });
    else this.postgres = new SQL(url, { max: 1, connectionTimeout: 15 });
  }
  private async rows(query: string, value: string) {
    const rows = this.sqlite
      ? this.sqlite.query(query).all(value)
      : await this.postgres!.unsafe(query.replace("?", "$1"), [value]);
    return z
      .array(
        z.object({
          name: z.string().optional(),
          completed: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
        }),
      )
      .parse(rows);
  }
  async user(email: string) {
    const rows = await this.rows('SELECT "name" FROM "user" WHERE "email" = ?', email);
    expect(rows, "Signup persisted exactly one user in the configured database").toEqual([
      { name: "Live Test" },
    ]);
  }
  async close() {
    this.sqlite?.close();
    await this.postgres?.close();
  }
}
