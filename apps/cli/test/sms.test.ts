import { describe, expect, test } from "bun:test";
import { beforeAll } from "bun:test";
import { join } from "node:path";

import { execa } from "execa";
import fs from "fs-extra";
import { parse } from "jsonc-parser";

import { ensureSmokeDirectory, SMOKE_DIR } from "./setup";

beforeAll(ensureSmokeDirectory);
const cli = join(import.meta.dir, "../dist/cli.mjs");

describe("SMS project generation through the CLI", () => {
  for (const provider of ["aliyun", "tencent", "twilio"]) {
    test(`generates only the requested ${provider} transport and enables phone login`, async () => {
      const projectName = `sms-${provider}`;
      await execa(
        "node",
        [
          cli,
          "create-json",
          "--json",
          JSON.stringify({
            projectName,
            product: { features: ["auth", "sms"], providers: { auth: [], sms: [provider] } },
            packageManager: "bun",
            install: false,
            git: false,
            disableAnalytics: true,
          }),
        ],
        { cwd: SMOKE_DIR, env: { XSTACK_SKIP_EXTERNAL_COMMANDS: "1", XSTACK_TEST_MODE: "1" } },
      );
      const project = join(SMOKE_DIR, projectName);
      const config = parse(await fs.readFile(join(project, "xstack.jsonc"), "utf8"));
      expect(config.product.providers.sms).toEqual([provider]);
      expect(
        await fs.pathExists(join(project, "apps/web/src/app/[lang]/login/phone/page.tsx")),
      ).toBe(true);
      for (const vendor of ["aliyun", "tencent", "twilio"]) {
        expect(await fs.pathExists(join(project, `packages/sms/src/providers/${vendor}.ts`))).toBe(
          vendor === provider,
        );
      }
    });
  }

  test("rejects SMS on a stack fallback and multiple SMS vendors", async () => {
    for (const options of [
      { frontend: ["nuxt"], product: { features: ["sms"], providers: { sms: ["aliyun"] } } },
      { product: { features: ["sms"], providers: { sms: ["aliyun", "twilio"] } } },
    ]) {
      const result = await execa(
        "node",
        [
          cli,
          "create-json",
          "--json",
          JSON.stringify({
            projectName: "invalid-sms",
            ...options,
            dryRun: true,
            install: false,
            git: false,
            disableAnalytics: true,
          }),
        ],
        {
          cwd: SMOKE_DIR,
          reject: false,
          env: { XSTACK_SKIP_EXTERNAL_COMMANDS: "1", XSTACK_TEST_MODE: "1" },
        },
      );
      expect(result.exitCode).not.toBe(0);
      expect(await fs.pathExists(join(SMOKE_DIR, "invalid-sms"))).toBe(false);
    }
  });
});
