import { expect, test } from "bun:test";

import type { ProjectConfig } from "@xstack/types";

import { generate } from "../src/generator";
import { EMBEDDED_TEMPLATES } from "../src/templates.generated";
import type { VirtualNode } from "../src/types";

const config: ProjectConfig = {
  projectName: "transactions",
  projectDir: "/tmp/transactions",
  relativePath: "transactions",
  frontend: ["react-router"],
  backend: "hono",
  runtime: "node",
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
    { id: "buyer", type: "web-frontend", stack: { framework: "react-router" } },
    { id: "staff", type: "admin", stack: { framework: "react-router" } },
    { id: "ledger", type: "backend", stack: { framework: "hono", runtime: "node", api: "none" } },
    { id: "tools", type: "cli", stack: { framework: "node" } },
  ],
  product: {
    features: ["affiliate", "admin"],
    providers: { auth: [], payment: ["stripe", "polar", "wechat", "alipay", "mock"] },
  },
};
function files(node: VirtualNode, out = new Map<string, string>()) {
  if (node.type === "file") out.set(node.path, node.content);
  else for (const child of node.children) files(child, out);
  return out;
}

test("transaction domain state and integrations have one backend owner while clients receive no domain dependencies", async () => {
  const result = await generate({ config, templates: EMBEDDED_TEMPLATES, trace: true });
  if (result.isErr()) throw result.error;
  const writes = result.value.provenance!.filter((record) =>
    /^packages\/(payment|credits|affiliate|db)\//.test(record.path),
  );
  expect(new Set(writes.map((record) => record.source.owner))).toEqual(new Set(["ledger"]));
  const output = files(result.value.root);
  for (const app of ["buyer", "staff"]) {
    const pkg = JSON.parse(output.get(`apps/${app}/package.json`)!);
    for (const domain of ["payment", "credits", "affiliate", "db", "auth"])
      expect(pkg.dependencies[`@transactions/${domain}`]).toBeUndefined();
    expect(output.has(`apps/${app}/src/integrations/payment-credits.ts`)).toBe(false);
  }
  expect(output.has("apps/ledger/src/integrations/payment-credits.ts")).toBe(true);
  expect(output.has("apps/ledger/src/integrations/affiliate-payment.ts")).toBe(true);
  expect(output.has("apps/tools/src/integrations/affiliate-payment.ts")).toBe(false);
});

test("selected transaction adapters cannot omit required payment fulfillment or administration contributions", async () => {
  for (const prefix of [
    "modules/payment/frameworks/http-server/apps/backend/",
    "modules/credits/integrations/payment/apps/backend/",
    "modules/payment/integrations/admin/shared/client/frameworks/react-router/",
  ]) {
    const templates = new Map(
      [...EMBEDDED_TEMPLATES].filter(([source]) => !source.startsWith(prefix)),
    );
    const result = await generate({ config, templates });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.phase).toBe("contributions");
  }
});
