import { expect, test } from "bun:test";

import type { ProjectConfig } from "@xstack/types";

import { resolveWorkspaceCapabilities } from "../src/contributions/capabilities";
import { buildWorkspacePlan } from "../src/contributions/workspace";
import { generate } from "../src/generator";
import { EMBEDDED_TEMPLATES } from "../src/templates.generated";

const config: ProjectConfig = {
  projectName: "split-identity",
  projectDir: "/tmp/split-identity",
  relativePath: "split-identity",
  frontend: ["react-router"],
  backend: "hono",
  runtime: "bun",
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
    { id: "portal", type: "web-frontend", stack: { framework: "react-router" } },
    { id: "console", type: "admin", stack: { framework: "react-router" } },
    { id: "gateway", type: "backend", stack: { framework: "hono", runtime: "bun", api: "none" } },
    { id: "tools", type: "cli", stack: { framework: "node" } },
  ],
  product: {
    features: ["auth", "admin", "email", "sms", "captcha"],
    providers: { auth: [], email: ["resend"], sms: ["twilio"], captcha: ["turnstile"] },
  },
};

test("native split identity owns server services once and keeps independent applications isolated", async () => {
  const capabilities = resolveWorkspaceCapabilities(config);
  expect(capabilities.issues).toEqual([]);
  for (const app of ["portal", "console", "gateway"])
    expect(capabilities.modules.filter((m) => m.app === app).map((m) => m.status)).toEqual(
      Array(7).fill("native"),
    );
  expect(
    capabilities.modules
      .filter((m) => m.app === "tools")
      .every((m) => m.status === "not-applicable"),
  ).toBe(true);
  const plan = buildWorkspacePlan(config, EMBEDDED_TEMPLATES);
  for (const pkg of ["auth", "db", "email", "sms", "captcha", "events", "permissions"]) {
    expect(plan.ownerOf(`packages/${pkg}/src/index.ts`)).toBe("gateway");
    expect(
      plan.applications
        .find((a) => a.app.selection.id === "portal")!
        .context.ownsPath(`packages/${pkg}`),
    ).toBe(false);
  }
  const result = await generate({ config, templates: EMBEDDED_TEMPLATES, trace: true });
  if (result.isErr()) throw result.error;
  const serviceWrites = result.value.provenance!.filter((r) =>
    /^packages\/(auth|db|email|sms|captcha|events|permissions)\//.test(r.path),
  );
  expect(new Set(serviceWrites.map((r) => r.source.owner))).toEqual(new Set(["gateway"]));
});

test("native split requires its selected client and backend adapters before writing", async () => {
  for (const prefix of [
    "modules/core/shared/client/frameworks/react-router/",
    "modules/admin/frameworks/http-server/apps/backend/",
    "modules/auth/integrations/email/shared/client/frameworks/react-router/",
  ]) {
    const templates = new Map([...EMBEDDED_TEMPLATES].filter(([path]) => !path.startsWith(prefix)));
    const result = await generate({ config, templates });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.phase).toBe("contributions");
  }
});

test("RPC stack auth and unsupported native modules do not inherit split native capability", () => {
  const rpc: ProjectConfig = {
    ...config,
    apps: config.apps!.map((app) =>
      app.type === "backend" ? { ...app, stack: { ...app.stack, api: "orpc" } } : app,
    ),
    product: { features: ["auth"], providers: { auth: [] } },
  };
  expect(
    resolveWorkspaceCapabilities(rpc)
      .modules.filter((m) => m.module === "auth" && m.app !== "tools")
      .map((m) => m.status),
  ).toEqual(["stack", "stack", "stack"]);
  expect(
    resolveWorkspaceCapabilities({
      ...config,
      product: { features: ["storage"], providers: { auth: [] } },
    }).issues.length,
  ).toBeGreaterThan(0);
});
