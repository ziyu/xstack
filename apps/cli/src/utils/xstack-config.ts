import * as fs from "node:fs/promises";
import path from "node:path";

import { XStackConfigSchema, type XStackConfig } from "@xstack/types";
import { Result } from "better-result";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";

import { CLIError } from "./errors";

const XSTACK_CONFIG_FILE = "xstack.jsonc";

function parseXStackConfig(content: string): XStackConfig {
  const errors: ParseError[] = [];
  const value = parse(content, errors, { allowTrailingComma: true });
  if (errors.length > 0) throw new Error("Invalid JSONC in xstack.jsonc");
  const selections = value?.addonOptions?.skills?.selections;
  if (Array.isArray(selections)) {
    for (const selection of selections) {
      if (selection?.source === "yusukebe/hono-skill") {
        selection.source = "honojs/skills";
      }
    }
  }
  return XStackConfigSchema.parse(value);
}

export async function readXStackConfig(projectDir: string): Promise<XStackConfig | null> {
  const result = await Result.tryPromise({
    try: async () =>
      parseXStackConfig(await fs.readFile(path.join(projectDir, XSTACK_CONFIG_FILE), "utf8")),
    catch: () => null,
  });
  return result.isOk() ? result.value : null;
}

export async function updateXStackConfig(
  projectDir: string,
  updates: Partial<
    Pick<
      XStackConfig,
      "addons" | "addonOptions" | "dbSetupOptions" | "webDeploy" | "serverDeploy"
    >
  >,
): Promise<Result<void, CLIError>> {
  return Result.tryPromise({
    try: async () => {
      const configPath = path.join(projectDir, XSTACK_CONFIG_FILE);
      let content = await fs.readFile(configPath, "utf8");
      XStackConfigSchema.parse({ ...parseXStackConfig(content), ...updates });
      for (const [key, value] of Object.entries(updates)) {
        content = applyEdits(
          content,
          modify(content, [key], value, { formattingOptions: { tabSize: 2 } }),
        );
      }
      await fs.writeFile(configPath, content, "utf8");
    },
    catch: (cause) =>
      new CLIError({
        message: `Failed to update xstack.jsonc: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      }),
  });
}
