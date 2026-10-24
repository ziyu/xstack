import { describe, expect, test } from "bun:test";

import {
  ApplicationManifestSchema,
  ApplicationSelectionSchema,
  type ApplicationSelection,
  type ProjectConfig,
} from "@xstack/types";

import { resolveApplicationConfig } from "../src/apps/config";
import { readFrameworkCatalog, resolveApplications } from "../src/apps/plan";
import { generate } from "../src/generator";
import { EMBEDDED_TEMPLATES } from "../src/templates.generated";
import type { VirtualNode } from "../src/types";

const full: ApplicationSelection = {
  id: "product",
  type: "fullstack-web",
  stack: { framework: "next" },
};
const split: ApplicationSelection[] = [
  { id: "site", type: "web-frontend", stack: { framework: "react-router" } },
  { id: "api", type: "backend", stack: { framework: "hono", runtime: "node", api: "orpc" } },
  { id: "admin", type: "admin", stack: { framework: "react-router" } },
];
const cli: ApplicationSelection = {
  id: "tools",
  type: "cli",
  stack: { framework: "node", runtime: "node" },
};
function config(apps: ApplicationSelection[]): ProjectConfig {
  return {
    projectName: "application-check",
    projectDir: "/tmp/application-check",
    relativePath: "application-check",
    frontend: ["next"],
    backend: "self",
    runtime: "none",
    api: "none",
    database: "sqlite",
    orm: "drizzle",
    dbSetup: "none",
    webDeploy: "none",
    serverDeploy: "none",
    packageManager: "bun",
    addons: ["turborepo"],
    git: false,
    install: false,
    apps,
    product: { features: [] },
  };
}
function files(node: VirtualNode, result = new Map<string, string>()) {
  if (node.type === "file") result.set(node.path, node.content);
  else for (const child of node.children) files(child, result);
  return result;
}

describe("stable application types and stack adapters", () => {
  test("application manifests require a valid default directory name", () => {
    const manifest = JSON.parse(EMBEDDED_TEMPLATES.get("apps/fullstack-web/app.json")!);
    expect(ApplicationManifestSchema.safeParse(manifest).success).toBe(true);
    for (const defaultDirectoryName of [undefined, "", "../web", "web/frontend"]) {
      expect(
        ApplicationManifestSchema.safeParse({ ...manifest, defaultDirectoryName }).success,
      ).toBe(false);
    }
  });
  test("fullstack-web owns web-frontend/backend/admin independent of its framework", () => {
    for (const framework of ["next", "nuxt"]) {
      const plan = resolveApplications(
        [{ ...full, stack: { framework } }, cli],
        EMBEDDED_TEMPLATES,
      );
      expect(plan.issues).toEqual([]);
      expect(plan.apps[0]?.selection.type).toBe("fullstack-web");
      expect(plan.apps[0]?.manifest.roles).toEqual(["web-frontend", "backend", "admin"]);
    }
  });
  test("fullstack-web excludes every split role, but not independent apps", async () => {
    expect(resolveApplications([full, cli], EMBEDDED_TEMPLATES).issues).toEqual([]);
    for (const app of split) {
      const result = await generate({
        config: config([full, app, cli]),
        templates: EMBEDDED_TEMPLATES,
      });
      expect(result.isErr()).toBe(true);
      expect(
        resolveApplications([full, app, cli], EMBEDDED_TEMPLATES).issues.map((issue) => issue.code),
      ).toContain("role-conflict");
    }
  });
  test("split applications resolve one backend and reject invalid connections", () => {
    const plan = resolveApplications([...split, cli], EMBEDDED_TEMPLATES);
    expect(plan.issues).toEqual([]);
    expect(plan.apps.find((app) => app.selection.id === "admin")?.bindings.backend).toBe("api");
    for (const apps of [
      [split[0]!],
      [full, { ...cli, id: "product" }],
      [full, { ...cli, product: "main" }],
      [split[0]!, { ...split[1]!, product: "other" }],
      [split[0]!, { ...split[1]!, id: "../api" }],
      [{ ...split[0]!, bindings: { backend: "tools" } }, split[1]!, cli],
    ])
      expect(resolveApplications(apps, EMBEDDED_TEMPLATES).issues.length).toBeGreaterThan(0);
  });
  test("legacy selections and unsupported adapters are rejected", () => {
    expect(
      ApplicationSelectionSchema.safeParse({ id: "product", template: "fullstack-next" }).success,
    ).toBe(false);
    for (const stack of [{ framework: "missing" }, { framework: "hono" }, {}]) {
      expect(
        resolveApplications([{ ...full, stack }], EMBEDDED_TEMPLATES).issues.length,
      ).toBeGreaterThan(0);
    }
  });
  test("adapter defaults and explicit runtime/API derive configuration", () => {
    expect(resolveApplicationConfig(config([full]))).toMatchObject({
      frontend: ["next"],
      backend: "self",
      runtime: "none",
      api: "none",
    });
    expect(resolveApplicationConfig(config(split))).toMatchObject({
      backend: "hono",
      runtime: "node",
      api: "orpc",
    });
    const defaultBackend = { ...split[1]!, stack: { framework: "hono" } };
    expect(resolveApplicationConfig(config([split[0]!, defaultBackend]))).toMatchObject({
      backend: "hono",
      runtime: "bun",
      api: "orpc",
    });
    expect(resolveApplicationConfig(config([cli]))).toMatchObject({ runtime: "node", api: "none" });
  });
  test("manifest ownership is authoritative and dependency cycles are rejected", () => {
    const templates = new Map(EMBEDDED_TEMPLATES);
    const manifest = {
      id: "worker",
      name: "Worker",
      defaultDirectoryName: "worker",
      scope: "product",
      roles: ["jobs"],
      requires: [],
    };
    templates.set("apps/worker/app.json", JSON.stringify(manifest));
    const adapter = JSON.parse(templates.get("cli/node/adapter.json")!);
    for (const type of ["worker", "scheduler"]) {
      adapter.apps[type] = { stack: { runtime: "node", api: "none" } };
      templates.set(
        `cli/node/apps/${type}/package.json`,
        JSON.stringify({ name: type, type: "module" }),
      );
    }
    templates.set("cli/node/adapter.json", JSON.stringify(adapter));
    const worker: ApplicationSelection = {
      id: "jobs",
      type: "worker",
      stack: { framework: "node" },
    };
    expect(resolveApplications([full, worker], templates).issues).toEqual([]);
    templates.set("apps/worker/app.json", JSON.stringify({ ...manifest, roles: ["admin"] }));
    expect(
      resolveApplications([full, worker], templates).issues.map((issue) => issue.code),
    ).toContain("role-conflict");
    templates.set("apps/worker/app.json", JSON.stringify({ ...manifest, requires: ["schedule"] }));
    templates.set(
      "apps/scheduler/app.json",
      JSON.stringify({ ...manifest, id: "scheduler", roles: ["schedule"], requires: ["jobs"] }),
    );
    expect(
      resolveApplications(
        [worker, { id: "schedule", type: "scheduler", stack: { framework: "node" } }],
        templates,
      ).issues.map((issue) => issue.code),
    ).toContain("binding-cycle");
  });
  for (const [name, apps] of [
    ["fullstack-web and CLI", [full, cli]],
    ["split and CLI", [...split, cli]],
    ["CLI only", [cli]],
  ] as const) {
    test(`generates ${name} into separate named workspaces`, async () => {
      const result = await generate({
        config: config([...apps]),
        templates: EMBEDDED_TEMPLATES,
        version: "test",
      });
      if (result.isErr()) throw result.error;
      const output = files(result.value.root);
      for (const app of apps) {
        expect(JSON.parse(output.get(`apps/${app.id}/package.json`)!).name).toBe(app.id);
        expect([...output.keys()].some((file) => file.startsWith(`apps/${app.id}/src/`))).toBe(
          true,
        );
      }
      expect(output.has("apps/web/package.json")).toBe(false);
      expect(output.has("apps/backend/package.json")).toBe(false);
      expect(output.has("apps/server/package.json")).toBe(false);
      expect(
        JSON.parse(output.get("applications.json")!).map((app: { id: string }) => app.id),
      ).toEqual(apps.map((app) => app.id));
    });
  }
  test("framework app contributions target only the selected named app without rewriting content", async () => {
    const templates = new Map(EMBEDDED_TEMPLATES);
    const content = 'export const logicalPath = "apps/web";\n';
    templates.set(
      "modules/core/frameworks/next/apps/fullstack-web/src/contribution.ts.hbs",
      content,
    );
    for (const type of ["web-frontend", "backend", "admin"]) {
      templates.set(
        `modules/core/frameworks/next/apps/${type}/src/unselected-${type}.ts.hbs`,
        content,
      );
    }
    const selected = config([full, cli]);
    selected.product = { features: ["auth", "credits"] };
    const result = await generate({ config: selected, templates, version: "test" });
    if (result.isErr()) throw result.error;
    const output = files(result.value.root);
    expect(output.get("apps/product/src/contribution.ts")).toBe(content);
    expect(output.has("apps/web/src/contribution.ts")).toBe(false);
    expect([...output.keys()].some((file) => file.includes("unselected-"))).toBe(false);
  });
  test("legacy no-app generation maps logical module paths to physical apps/web", async () => {
    const selected = config([]);
    delete selected.apps;
    selected.product = { features: ["auth", "credits"] };
    const result = await generate({ config: selected, templates: EMBEDDED_TEMPLATES });
    if (result.isErr()) throw result.error;
    const output = files(result.value.root);
    expect(output.has("apps/web/package.json")).toBe(true);
    expect(output.has("apps/web/src/services.ts")).toBe(true);
    expect(output.get("docs/modules/core.md")).toContain("apps/web/src/services.ts");
    expect([...output.keys()].some((path) => path.startsWith("apps/fullstack-web/"))).toBe(false);
    expect([...output.keys()].some((path) => path.startsWith("apps/web-frontend/"))).toBe(false);
  });
  test("technology-local app folders select implementation without a path map", async () => {
    const templates = new Map(EMBEDDED_TEMPLATES);
    templates.set(
      "cli/example/adapter.json",
      JSON.stringify({ id: "example", apps: { cli: { stack: { runtime: "node", api: "none" } } } }),
    );
    templates.set(
      "cli/example/shared/src/greet.js",
      "export const greet = name => `Hello, ${name}!`;\n",
    );
    templates.set(
      "cli/example/apps/cli/package.json",
      JSON.stringify({ name: "cli", type: "module" }),
    );
    templates.set(
      "cli/example/apps/cli/src/index.js",
      'import {greet} from "./greet.js"; console.log(greet("folder"));\n',
    );
    const result = await generate({
      config: config([{ id: "command", type: "cli", stack: { framework: "example" } }]),
      templates,
    });
    if (result.isErr()) throw result.error;
    const output = files(result.value.root);
    expect(output.get("apps/command/src/index.js")).toContain('from "./greet.js"');
    expect(output.has("apps/command/src/greet.js")).toBe(true);
    expect(output.has("apps/command/adapter.json")).toBe(false);
    templates.set("cli/example/apps/admin/package.json", "{}");
    expect(() => readFrameworkCatalog(templates)).toThrow();
  });
  test("declared apps require their own implementation directory", () => {
    const templates = new Map(EMBEDDED_TEMPLATES);
    templates.set(
      "frontend/example/adapter.json",
      JSON.stringify({
        id: "example",
        apps: { "web-frontend": { stack: { frontend: ["astro"] } } },
      }),
    );
    templates.set("frontend/example/shared/package.json", "{}");
    expect(() => readFrameworkCatalog(templates)).toThrow();
  });
});
