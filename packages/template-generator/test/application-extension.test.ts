import { expect, test } from "bun:test";

import {
  FrameworkAdapterSchema,
  type ProjectConfig,
  type ApplicationSelection,
} from "@xstack/types";

import { generate } from "../src/generator";
import { EMBEDDED_TEMPLATES } from "../src/templates.generated";
import type { VirtualNode } from "../src/types";

function config(apps: ApplicationSelection[]): ProjectConfig {
  return {
    projectName: "extension-check",
    projectDir: "/tmp/extension-check",
    relativePath: "extension-check",
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
    apps,
    product: { features: ["auth", "admin"], providers: { auth: [] } },
  };
}
function files(node: VirtualNode, output = new Map<string, string>()) {
  if (node.type === "file") output.set(node.path, node.content);
  else for (const child of node.children) files(child, output);
  return output;
}

function extensionTemplates() {
  const templates = new Map(EMBEDDED_TEMPLATES);
  templates.set(
    "apps/control-room/app.json",
    JSON.stringify({
      id: "control-room",
      name: "Control room",
      defaultDirectoryName: "operations",
      roles: ["admin"],
      scope: "product",
      requires: ["backend"],
    }),
  );
  const router = FrameworkAdapterSchema.parse(
    JSON.parse(templates.get("frontend/react/react-router/adapter.json")!),
  );
  templates.set(
    "frontend/react/custom-router/adapter.json",
    JSON.stringify({ id: "custom-router", apps: { "control-room": router.apps.admin } }),
  );
  for (const [source, content] of EMBEDDED_TEMPLATES) {
    const base = "frontend/react/react-router/";
    if (source.startsWith(`${base}shared/`))
      templates.set(source.replace(base, "frontend/react/custom-router/"), content);
    if (source.startsWith(`${base}apps/admin/`))
      templates.set(
        source.replace(`${base}apps/admin/`, "frontend/react/custom-router/apps/control-room/"),
        content,
      );
    if (source.startsWith("modules/") && source.includes("/apps/admin/"))
      templates.set(source.replace("/apps/admin/", "/apps/control-room/"), content);
  }
  return templates;
}
const selections: ApplicationSelection[] = [
  { id: "zz-customer", type: "web-frontend", stack: { framework: "react-router" } },
  { id: "aa-operator", type: "control-room", stack: { framework: "custom-router" } },
  {
    id: "identity-service",
    type: "backend",
    stack: { framework: "hono", runtime: "node", api: "none" },
  },
  { id: "maintenance", type: "cli", stack: { framework: "node" } },
];

test("new application type and framework adapter integrate through declarations without engine branches", async () => {
  const result = await generate({ config: config(selections), templates: extensionTemplates() });
  if (result.isErr()) throw result.error;
  const output = files(result.value.root);
  expect(output.has("apps/aa-operator/src/components/admin/admin-pages.tsx")).toBe(true);
  expect(output.has("apps/identity-service/src/lib/native/admin.ts")).toBe(true);
  expect(output.has("apps/maintenance/src/index.js")).toBe(true);
  const root = JSON.parse(output.get("package.json")!);
  expect(root.scripts["dev:aa-operator"]).toBe("bun run --filter aa-operator dev");
  expect(output.has("apps/admin/package.json")).toBe(false);
  const apps = JSON.parse(output.get("applications.json")!);
  expect(apps.find((app: { id: string }) => app.id === "aa-operator")).toMatchObject({
    type: "control-room",
    roles: ["admin"],
    directory: "apps/aa-operator",
    bindings: { backend: "identity-service" },
  });
});

test("declared custom app requires its actual role overlay instead of silently emitting a generic shell", async () => {
  const templates = extensionTemplates();
  for (const source of templates.keys())
    if (source.startsWith("modules/core/") && source.includes("/apps/control-room/"))
      templates.delete(source);
  const result = await generate({ config: config(selections), templates });
  expect(result.isErr()).toBe(true);
  if (result.isErr()) expect(result.error.phase).toBe("contributions");
});
