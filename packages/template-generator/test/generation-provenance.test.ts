import { expect, test } from "bun:test";

import type { ProjectConfig } from "@xstack/types";

import { generate } from "../src/generator";
import { EMBEDDED_TEMPLATES } from "../src/templates.generated";
const config: ProjectConfig = {
  projectName: "provenance",
  projectDir: "/tmp/provenance",
  relativePath: "provenance",
  frontend: ["next"],
  backend: "self",
  runtime: "none",
  api: "none",
  database: "sqlite",
  orm: "drizzle",
  dbSetup: "none",
  webDeploy: "none",
  serverDeploy: "none",
  addons: [],
  packageManager: "bun",
  git: false,
  install: false,
  apps: [
    { id: "portal", type: "fullstack-web", stack: { framework: "next" } },
    { id: "tools", type: "cli", stack: { framework: "node" } },
  ],
  product: { features: ["auth"], providers: { auth: [] } },
};
test("trace follows template replacement and processor edits without recording contents", async () => {
  const result = await generate({ config, templates: EMBEDDED_TEMPLATES, trace: true });
  if (result.isErr()) throw result.error;
  const trace = result.value.provenance!;
  expect(
    trace.some((r) => r.path === "apps/portal/src/app/page.tsx" && r.operation === "delete"),
  ).toBe(true);
  const manifest = trace.filter((r) => r.path === "apps/portal/package.json");
  expect(
    manifest.some(
      (r) => r.source.kind === "template" && r.source.name.includes("frontend/react/next/"),
    ),
  ).toBe(true);
  expect(manifest.some((r) => r.operation === "update" && r.previousSource !== undefined)).toBe(
    true,
  );
  expect(
    trace
      .filter((r) => r.path.startsWith("packages/auth/"))
      .every((r) => r.source.owner === "portal"),
  ).toBe(true);
  expect(trace.some((r) => r.source.name === "unattributed")).toBe(false);
  expect(trace.every((r) => !Object.hasOwn(r, "content"))).toBe(true);
  const ordinary = await generate({ config, templates: EMBEDDED_TEMPLATES });
  if (ordinary.isErr()) throw ordinary.error;
  expect(ordinary.value.provenance).toBeUndefined();
});
