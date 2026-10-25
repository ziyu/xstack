import { expect, test } from "bun:test";

import type { ApplicationSelection, ProjectConfig } from "@xstack/types";

import { resolveWorkspaceCapabilities } from "../src/contributions/capabilities";
import { appOutputPath, resolveApplicationContext } from "../src/contributions/context";
import { planStackContributions } from "../src/contributions/preflight";
import { buildWorkspacePlan } from "../src/contributions/workspace";
import { VirtualFileSystem } from "../src/core/virtual-fs";
import { getModulePlan, toRenderConfig } from "../src/modules/pipeline";
import {
  addAppDependencies,
  appendEnv,
  declareEnvSchema,
  replaceStackFiles,
  wireServices,
} from "../src/modules/seams";
import { processEnvVariables } from "../src/processors/env-vars";
import { processVarlock } from "../src/processors/varlock";
import { EMBEDDED_TEMPLATES } from "../src/templates.generated";

function config(apps: ApplicationSelection[]): ProjectConfig {
  return {
    projectName: "contexts",
    projectDir: "/tmp/contexts",
    relativePath: "contexts",
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
    apps,
    product: { features: ["auth"], providers: { auth: [] } },
  };
}

const split: ApplicationSelection[] = [
  { id: "dashboard", type: "web-frontend", stack: { framework: "react-router" } },
  { id: "gateway", type: "backend", stack: { framework: "hono", runtime: "node", api: "orpc" } },
  { id: "tools", type: "cli", stack: { framework: "node", runtime: "node" } },
];

test("workspace, capabilities and preflight consume the same isolated application projection", () => {
  const input = config(split);
  const plan = buildWorkspacePlan(input, EMBEDDED_TEMPLATES);
  const capabilities = resolveWorkspaceCapabilities(input, EMBEDDED_TEMPLATES);
  const contributions = planStackContributions(input, EMBEDDED_TEMPLATES);
  expect(capabilities.issues).toEqual([]);
  for (const entry of plan.applications) {
    const local = resolveApplicationContext(plan.config, entry.app);
    expect(entry.config).toEqual(local);
    expect(local.apps).toBeUndefined();
    for (const module of getModulePlan(local).modules) {
      expect(
        capabilities.modules.find(
          (item) => item.app === entry.app.selection.id && item.module === module.manifest.id,
        )?.status,
      ).toBe(module.variant);
    }
  }
  const independent = plan.applications.find((entry) => entry.app.selection.id === "tools")!;
  expect(independent.config).toMatchObject({
    frontend: ["none"],
    backend: "none",
    api: "none",
    database: "none",
    orm: "none",
    product: { features: [] },
  });
  expect(contributions.filter((item) => item.app === "tools")).toEqual([]);
  expect(
    contributions.some(
      (item) =>
        item.app === "dashboard" && item.output === "apps/dashboard" && item.kind === "prefix",
    ),
  ).toBe(true);
  expect(
    contributions.some((item) => item.app === "gateway" && item.output.startsWith("apps/gateway/")),
  ).toBe(true);
  const client = plan.applications.find((entry) => entry.app.selection.id === "dashboard")!;
  const render = { ...toRenderConfig(client.config), application: client.context };
  expect(appOutputPath(render, "web", ".env")).toBe("apps/dashboard/.env");
  expect(appOutputPath(render, "server", "src/services.ts")).toBe("apps/gateway/src/services.ts");
  expect(client.context.ownsPath("apps/gateway")).toBe(false);
});

test("named fullstack env and module seams work without VFS aliases", () => {
  const plan = buildWorkspacePlan(
    config([{ id: "portal", type: "fullstack-web", stack: { framework: "next" } }]),
    EMBEDDED_TEMPLATES,
  );
  const entry = plan.applications[0]!;
  const render = { ...toRenderConfig(entry.config), application: entry.context };
  const vfs = new VirtualFileSystem();
  vfs.writeJson("apps/portal/package.json", {});
  vfs.writeJson("packages/db/package.json", {});
  vfs.writeFile("apps/portal/src/app/page.tsx", "old page");
  processEnvVariables(vfs, render);
  processVarlock(vfs, EMBEDDED_TEMPLATES, render);
  expect(vfs.readFile("apps/portal/.env.schema")).toContain("DATABASE_URL=");
  expect(vfs.readFile("packages/db/.env.schema")).toContain("../../apps/portal/");
  expect(vfs.readFile("apps/portal/src/services.ts")).toContain("createDb");
  addAppDependencies(vfs, { example: "1.0.0" }, render);
  const entries = [
    { module: "example", spec: { key: "EXAMPLE", type: "string" as const, default: "value" } },
  ];
  appendEnv(vfs, entries, render);
  declareEnvSchema(vfs, entries, render);
  wireServices(vfs, render, []);
  expect(vfs.readFile("apps/portal/.env")).toContain("EXAMPLE=value");
  expect(vfs.readFile("apps/portal/.env.schema")).toContain("EXAMPLE=value");
  expect(
    vfs.readJson<{ dependencies: Record<string, string> }>("apps/portal/package.json")?.dependencies
      .example,
  ).toBe("1.0.0");
  expect(
    replaceStackFiles(vfs, "example", ["apps/fullstack-web/src/app/page.tsx"], render),
  ).toEqual(["apps/portal/src/app/page.tsx"]);
  expect(
    vfs
      .getAllFiles()
      .some((path) => path.startsWith("apps/web/") || path.startsWith("apps/server/")),
  ).toBe(false);
});

test("split clients do not receive backend schema or services without aliases", () => {
  const plan = buildWorkspacePlan(config(split), EMBEDDED_TEMPLATES);
  const entry = plan.applications.find((item) => item.app.selection.id === "dashboard")!;
  const render = { ...toRenderConfig(entry.config), application: entry.context };
  const vfs = new VirtualFileSystem({}, { ownsPath: entry.context.ownsPath });
  vfs.writeJson("apps/dashboard/package.json", {});
  processEnvVariables(vfs, render);
  processVarlock(vfs, EMBEDDED_TEMPLATES, render);
  expect(vfs.readFile("apps/dashboard/.env")).toContain("VITE_SERVER_URL=");
  expect(vfs.readFile("apps/dashboard/.env.schema")).not.toContain("DATABASE_URL=");
  expect(vfs.exists("apps/dashboard/src/services.ts")).toBe(false);
  expect(vfs.getAllFiles().every((path) => path.startsWith("apps/dashboard/"))).toBe(true);
});

test("legacy paths retain self-hosted and split backend defaults", () => {
  const legacy = { ...config([]), apps: undefined };
  expect(appOutputPath(legacy, "web", ".env")).toBe("apps/web/.env");
  expect(appOutputPath(legacy, "server", ".env")).toBe("apps/web/.env");
  expect(appOutputPath({ ...legacy, backend: "hono" }, "server", ".env")).toBe("apps/server/.env");
  expect(appOutputPath(legacy, "native", ".env")).toBe("apps/native/.env");
});
