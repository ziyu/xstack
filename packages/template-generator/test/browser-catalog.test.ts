import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("module catalog bundles for browsers without Node rendering dependencies", async () => {
  const result = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "../src/modules/index.ts")],
    target: "browser",
  });
  expect(result.success, result.logs.map(String).join("\n")).toBe(true);
});
