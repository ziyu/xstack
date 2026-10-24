import { expect, test } from "bun:test";

import type { ProjectConfig } from "@xstack/types";

import { resolveWorkspaceCapabilities } from "../src/contributions/capabilities";
import { generate } from "../src/generator";
import { EMBEDDED_TEMPLATES } from "../src/templates.generated";
const config: ProjectConfig = {
  projectName: "preflight",
  projectDir: "/tmp/preflight",
  relativePath: "preflight",
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
  apps: [{ id: "portal", type: "fullstack-web", stack: { framework: "next" } }],
  product: { features: ["auth", "payment"], providers: { auth: [], payment: ["stripe"] } },
};
test("generation refuses selected provider loss and unknown app contributions", async () => {
  for (const templates of [
    new Map(
      [...EMBEDDED_TEMPLATES].filter(
        ([path]) => !path.startsWith("modules/payment/providers/stripe/"),
      ),
    ),
    new Map([
      ...EMBEDDED_TEMPLATES,
      ["modules/payment/frameworks/next/apps/web/src/wrong.ts", "export {};"],
    ]),
  ]) {
    const result = await generate({ config, templates });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.phase).toBe("contributions");
  }
});
test("capabilities distinguish legacy auth from unsupported native split business", () => {
  const split = {
    ...config,
    apps: [
      { id: "frontend", type: "web-frontend", stack: { framework: "react-router" } },
      { id: "backend", type: "backend", stack: { framework: "hono" } },
    ],
    product: { features: ["auth"], providers: { auth: [] } },
  };
  const auth = resolveWorkspaceCapabilities(split);
  expect(auth.issues).toEqual([]);
  expect(auth.modules.filter((m) => m.module === "auth").every((m) => m.status === "stack")).toBe(
    true,
  );
  expect(auth.notes.some((n) => n.includes("not native"))).toBe(true);
  expect(
    resolveWorkspaceCapabilities({ ...split, product: { features: ["payment"] } }).issues.length,
  ).toBeGreaterThan(0);
});
