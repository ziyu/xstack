import { beforeAll, expect, test } from "bun:test";
import { join } from "node:path";

import { execa } from "execa";
import fs from "fs-extra";
import { parse } from "jsonc-parser";

import { ensureSmokeDirectory, SMOKE_DIR } from "./setup";

const cliPath = join(import.meta.dir, "../dist/cli.mjs");

beforeAll(ensureSmokeDirectory);

function runCli(args: string[], env: Record<string, string> = {}) {
  return execa("node", [cliPath, ...args], {
    cwd: SMOKE_DIR,
    timeout: 15_000,
    env: {
      XSTACK_TELEMETRY: "0",
      XSTACK_SKIP_EXTERNAL_COMMANDS: "0",
      XSTACK_TEST_MODE: "0",
      ...env,
    },
  });
}

test("schema stdout is valid JSON for command-line consumers", async () => {
  const { stdout } = await runCli(["schema", "--name", "createInput"]);
  expect(JSON.parse(stdout)).toMatchObject({ type: "object" });
});

test("create-json preserves dry-run behavior and emits a JSON result", async () => {
  const { stdout } = await runCli([
    "create-json",
    "--json",
    JSON.stringify({
      projectName: "json-dry-run",
      yes: true,
      install: false,
      git: false,
      dryRun: true,
      disableAnalytics: true,
    }),
  ]);
  expect(JSON.parse(stdout)).toMatchObject({ success: true });
  expect(await fs.pathExists(join(SMOKE_DIR, "json-dry-run"))).toBe(false);
});

test("default create respects negated flags and add-json creates a workspace package", async () => {
  const projectDir = join(SMOKE_DIR, "command-output");
  await runCli([
    "command-output",
    "--yes",
    "--no-install",
    "--no-git",
    "--no-render-title",
    "--disable-analytics",
  ]);
  expect(await fs.pathExists(join(projectDir, "xstack.jsonc"))).toBe(true);
  expect(await fs.pathExists(join(projectDir, "node_modules"))).toBe(false);
  expect(await fs.pathExists(join(projectDir, ".git"))).toBe(false);

  const { stdout } = await runCli([
    "add-json",
    "--json",
    JSON.stringify({ projectDir, package: "shared", install: false, disableAnalytics: true }),
  ]);
  expect(JSON.parse(stdout)).toMatchObject({ success: true });
  expect(await fs.pathExists(join(projectDir, "packages/shared/src/index.ts"))).toBe(true);
});

for (const packageManager of ["bun", "pnpm", "npm"] as const) {
  test(`generated ${packageManager} command targets xstack and reproduces the selected modules`, async () => {
    const env = { XSTACK_SKIP_EXTERNAL_COMMANDS: "1" };
    const { stdout } = await runCli(
      [
        "create-json",
        "--json",
        JSON.stringify({
          projectName: `reproduce-${packageManager}`,
          preset: "saas-global",
          product: { features: [], options: { i18n: { locales: "en,zh-CN" } } },
          packageManager,
          install: false,
          git: false,
          dryRun: true,
          disableAnalytics: true,
        }),
      ],
      env,
    );
    const original = JSON.parse(stdout);
    const command = original.reproducibleCommand.split(" ");
    const prefix =
      packageManager === "npm"
        ? ["npx", "xstack@latest"]
        : [packageManager, "create", "xstack@latest"];
    expect(command.slice(0, prefix.length)).toEqual(prefix);
    await runCli(
      ["create", ...command.slice(prefix.length), "--disable-analytics", "--no-render-title"],
      env,
    );
    const recreated = parse(
      await fs.readFile(join(SMOKE_DIR, `reproduce-${packageManager}`, "xstack.jsonc"), "utf8"),
    );
    expect(recreated).toMatchObject({
      packageManager,
      frontend: original.projectConfig.frontend,
      backend: original.projectConfig.backend,
      database: original.projectConfig.database,
      orm: original.projectConfig.orm,
      product: original.projectConfig.product,
    });
  });
}
