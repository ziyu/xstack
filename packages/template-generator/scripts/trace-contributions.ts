import { readFile } from "node:fs/promises";

import { ProjectConfigSchema } from "@xstack/types";

import { loadTemplates } from "../src/core/template-reader";
import { generate } from "../src/generator";

const input = process.argv[2];
if (!input) throw new Error("Usage: trace-contributions.ts <project-config.json> [output-path]");
const config = ProjectConfigSchema.parse(Bun.JSONC.parse(await readFile(input, "utf8")));
const result = await generate({ config, templates: await loadTemplates(), trace: true });
if (result.isErr()) {
  console.error(result.error.message);
  process.exitCode = 1;
} else {
  const output = process.argv[3];
  console.log(
    JSON.stringify(
      output
        ? result.value.provenance?.filter((record) => record.path === output)
        : result.value.provenance,
      null,
      2,
    ),
  );
}
