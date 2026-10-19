import { test, expect } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { XStackConfigSchema } from "@xstack/types";

import { PRESET_TEMPLATES } from "../src/lib/constant";
import { generateStackCommand } from "../src/lib/stack-utils";

// Exercise the actual copied shell arguments against the built local CLI, without npm publication.
test("builder command creates the requested provider-specific product without prompts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xstack-builder-command-"));
  try {
    const stack = {
      ...PRESET_TEMPLATES.find((preset) => preset.id === "saas-global")!.stack,
      projectName: "builder-product",
      packageManager: "bun" as const,
      install: "false" as const,
      git: "false" as const,
      providers: { auth: [], email: ["smtp"], payment: ["polar"] },
      moduleOptions: { i18n: { locales: "zh-CN" }, credits: { signupBonus: 50 } },
    };
    const command = generateStackCommand(stack);
    const prefix = "bun create xstack@latest ";
    expect(command.startsWith(prefix)).toBe(true);
    const cli = resolve(import.meta.dir, "../../cli/dist/cli.mjs");
    const child = spawn(
      "sh",
      [
        "-c",
        'exec node "$XSTACK_LOCAL_CLI" ' +
          command.slice(prefix.length) +
          " --disable-analytics --no-render-title",
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          XSTACK_LOCAL_CLI: cli,
          XSTACK_SKIP_EXTERNAL_COMMANDS: "1",
          DO_NOT_TRACK: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 15000,
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    expect(exitCode, output).toBe(0);
    const project = join(directory, "builder-product");
    const config = XStackConfigSchema.parse(
      Bun.JSONC.parse(await readFile(join(project, "xstack.jsonc"), "utf8")),
    );
    expect(config.product?.providers).toEqual(stack.providers);
    expect(Number(config.product?.options?.credits?.signupBonus)).toBe(50);
    expect(
      await readFile(join(project, "apps/web/src/integrations/credits-signup.ts"), "utf8"),
    ).toContain("SIGNUP_BONUS = 50");
    expect(config.product?.options?.i18n?.locales).toBe("zh-CN");
    const email = JSON.parse(await readFile(join(project, "packages/email/package.json"), "utf8"));
    expect(email.dependencies.nodemailer).toBeDefined();
    const payment = JSON.parse(
      await readFile(join(project, "packages/payment/package.json"), "utf8"),
    );
    expect(payment.dependencies["@polar-sh/sdk"]).toBeDefined();
    expect(payment.dependencies.stripe).toBeUndefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 20000);
