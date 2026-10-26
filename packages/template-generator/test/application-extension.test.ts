import { expect, test } from "bun:test";

import {
  FrameworkAdapterSchema,
  type ProjectConfig,
  type ApplicationSelection,
} from "@xstack/types";

import {
  applicationOptions,
  convertLegacyApplications,
  readFrameworkCatalog,
  resolveApplications,
} from "../src/apps";
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
    JSON.stringify({
      id: "custom-router",
      name: "Operations router",
      description: "Custom administration shell",
      icon: "/icons/react-router.svg",
      apps: { "control-room": router.apps.admin },
    }),
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

test("renamed adapters expose declared controls and enforce them during generation", async () => {
  const templates = extensionTemplates();
  const path = "backend/server/hono/adapter.json";
  const declaration = FrameworkAdapterSchema.parse(JSON.parse(templates.get(path)!));
  declaration.id = "service-engine";
  declaration.name = "Service engine";
  declaration.apps.backend!.stack.runtime = "node";
  declaration.apps.backend!.options = {
    runtime: { values: ["node"], visibility: "visible" },
    api: { values: ["none", "orpc"], visibility: "advanced" },
  };
  templates.set(path, JSON.stringify(declaration));
  const selected = selections.map((app) =>
    app.id === "identity-service"
      ? { ...app, stack: { ...app.stack, framework: "service-engine" } }
      : app,
  );
  const catalog = readFrameworkCatalog(templates);
  expect(catalog.get("custom-router")?.name).toBe("Operations router");
  expect(applicationOptions(catalog.get("service-engine")!.apps.backend!).runtime.values).toEqual([
    "node",
  ]);
  const result = await generate({ config: config(selected), templates });
  if (result.isErr()) throw result.error;
  expect(files(result.value.root).has("apps/identity-service/src/lib/native/admin.ts")).toBe(true);
  const invalid = selected.map((app) =>
    app.id === "identity-service"
      ? { ...app, stack: { ...app.stack, runtime: "bun" as const } }
      : app,
  );
  const rejected = await generate({ config: config(invalid), templates });
  expect(rejected.isErr()).toBe(true);
  if (rejected.isErr()) expect(rejected.error.message).toContain("select runtime node");
  expect(invalid.find((app) => app.id === "identity-service")?.stack.runtime).toBe("bun");
});

test("backend API compatibility follows the client declaration", () => {
  const templates = extensionTemplates();
  const path = "frontend/react/custom-router/adapter.json";
  const declaration = FrameworkAdapterSchema.parse(JSON.parse(templates.get(path)!));
  declaration.apps["control-room"]!.acceptsBackendApis = ["orpc"];
  templates.set(path, JSON.stringify(declaration));
  expect(resolveApplications(selections, templates).issues).toContainEqual({
    code: "unsupported-stack",
    app: "aa-operator",
    message: "Application aa-operator does not support backend API none",
  });
});

test("legacy conversion discovers renamed native adapters and reports ambiguous or unsupported mappings", () => {
  const templates = new Map(EMBEDDED_TEMPLATES);
  const path = "frontend/native/bare/adapter.json";
  const declaration = FrameworkAdapterSchema.parse(JSON.parse(templates.get(path)!));
  declaration.id = "mobile-shell";
  templates.set(path, JSON.stringify(declaration));
  const converted = convertLegacyApplications(
    { frontend: ["native-bare"], backend: "none", runtime: "none", api: "none" },
    templates,
  );
  expect(converted.issues).toEqual([]);
  expect(converted.apps).toEqual([
    { id: "native", type: "native", stack: { framework: "mobile-shell" } },
  ]);
  templates.set(
    "apps/handheld/app.json",
    JSON.stringify({
      id: "handheld",
      name: "Handheld shell",
      defaultDirectoryName: "handheld",
      roles: [],
      requires: [],
      scope: "independent",
    }),
  );
  declaration.apps.handheld = declaration.apps.native!;
  templates.set(path, JSON.stringify(declaration));
  for (const [source, content] of templates)
    if (source.startsWith("frontend/native/bare/apps/native/"))
      templates.set(source.replace("/apps/native/", "/apps/handheld/"), content);
  expect(convertLegacyApplications({ frontend: ["native-bare"] }, templates).issues[0]?.code).toBe(
    "ambiguous-legacy-mapping",
  );
  declaration.apps.native!.legacy = false;
  declaration.apps.handheld = { ...declaration.apps.handheld!, legacy: true };
  templates.set(path, JSON.stringify(declaration));
  const custom = convertLegacyApplications({ frontend: ["native-bare"] }, templates);
  expect(custom.issues).toEqual([]);
  expect(custom.apps[0]).toMatchObject({ type: "handheld", stack: { framework: "mobile-shell" } });
  expect(
    convertLegacyApplications({ frontend: ["none"], backend: "convex" }, templates).issues[0]?.code,
  ).toBe("unsupported-legacy-mapping");
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
