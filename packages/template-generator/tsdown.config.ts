import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/fs-writer.ts",
    "src/templates-binary.ts",
    "src/core/template-reader.ts",
    "src/modules/index.ts",
    "src/apps/index.ts",
    "src/builder/index.ts",
  ],
  format: ["esm"],
  clean: true,
  shims: true,
  outDir: "dist",
  dts: true,
});
