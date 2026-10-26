import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { EMBEDDED_TEMPLATES, generate, type VirtualNode } from "@xstack/template-generator";
import {
  readApplicationCatalog,
  readFrameworkCatalog,
  resolveApplicationConfig,
} from "@xstack/template-generator/apps";
import { readBuilderDefinition } from "@xstack/template-generator/builder";
import { readModuleCatalog, readProductPresets } from "@xstack/template-generator/modules";
import { FrameworkAdapterSchema, ProjectConfigSchema } from "@xstack/types";

import { createBuilderCatalog } from "../src/lib/builder-catalog";
import { DEFAULT_STACK } from "../src/lib/constant";
import { resolveStackCompatibility } from "../src/lib/stack-compatibility";
import { StackStateSchema } from "../src/lib/stack-schema";

function collect(node: VirtualNode, files = new Map<string, string>()) {
  if (node.type === "file") files.set(node.path, node.content);
  else for (const child of node.children) collect(child, files);
  return files;
}

test("template-owned application, adapter, module and preset generate executable configured behavior", async () => {
  const templates = new Map(EMBEDDED_TEMPLATES);
  templates.set(
    "apps/automation/app.json",
    JSON.stringify({
      id: "automation",
      name: "Automation tool",
      defaultDirectoryName: "tools",
      scope: "independent",
      roles: [],
      requires: [],
      technologyLabel: "Automation implementation",
    }),
  );
  const adapter = FrameworkAdapterSchema.parse(JSON.parse(templates.get("cli/node/adapter.json")!));
  templates.set(
    "cli/custom-engine/adapter.json",
    JSON.stringify({
      id: "custom-engine",
      name: "Custom automation engine",
      apps: { automation: adapter.apps.cli },
    }),
  );
  for (const [path, content] of EMBEDDED_TEMPLATES) {
    if (path.startsWith("cli/node/apps/cli/"))
      templates.set(
        path.replace("cli/node/apps/cli/", "cli/custom-engine/apps/automation/"),
        content,
      );
    if (path.startsWith("cli/node/shared/"))
      templates.set(path.replace("cli/node/", "cli/custom-engine/"), content);
  }
  templates.set(
    "modules/custom-meter/module.json",
    JSON.stringify({
      id: "custom-meter",
      name: { en: "Custom meter", "zh-CN": "自定义计量" },
      description: { en: "Template-configured metering", "zh-CN": "模板配置的计量" },
      category: "operations",
      providers: {
        min: 1,
        max: 1,
        default: { global: ["local"], cn: ["local"] },
        options: { local: { name: "Local meter", market: "any" } },
      },
      options: { multiplier: { type: "number", default: 1, min: 1, integer: true } },
      packages: [{ dir: "custom-meter" }],
      sources: {
        providers: { mode: "inline", source: "files/packages/custom-meter/src/index.ts.hbs" },
      },
    }),
  );
  templates.set(
    "modules/custom-meter/files/packages/custom-meter/src/index.ts.hbs",
    'export function charge(units: number) { return { units: units * {{module.options.multiplier}}, provider: "{{module.providers.[0]}}" }; }',
  );
  const declaration = readBuilderDefinition(templates);
  declaration.presets.push({
    id: "custom-workbench",
    name: "Custom workbench",
    description: "User-owned configuration",
    group: "Custom",
    stack: {
      apps: [
        ...DEFAULT_STACK.apps!,
        { id: "operations", type: "automation", stack: { framework: "custom-engine" } },
      ],
      features: ["custom-meter"],
      providers: { "custom-meter": ["local"] },
      moduleOptions: { "custom-meter": { multiplier: 7 } },
    },
  });
  declaration.defaultPreset = "custom-workbench";
  templates.set("builder.json", JSON.stringify(declaration));
  const catalog = createBuilderCatalog(
    readBuilderDefinition(templates),
    readModuleCatalog(templates),
    readProductPresets(templates),
  );
  expect(catalog.options.features.find((entry) => entry.id === "custom-meter")?.name).toBe(
    "Custom meter",
  );
  expect(readApplicationCatalog(templates).get("automation")?.defaultDirectoryName).toBe("tools");
  expect(readFrameworkCatalog(templates).get("custom-engine")?.name).toBe(
    "Custom automation engine",
  );
  const stack = catalog.defaults;
  const config = resolveApplicationConfig(
    ProjectConfigSchema.parse({
      ...stack,
      projectName: "custom-template-check",
      projectDir: "/virtual",
      relativePath: "custom-template-check",
      frontend: stack.webFrontend,
      backend: "self",
      git: false,
      install: false,
      product: {
        features: stack.features,
        providers: stack.providers,
        options: stack.moduleOptions,
      },
    }),
    templates,
  );
  const result = await generate({ config, templates });
  if (result.isErr()) throw result.error;
  const files = collect(result.value.root);
  const apps = JSON.parse(files.get("applications.json")!);
  expect(apps.find((app: { id: string }) => app.id === "operations")).toMatchObject({
    type: "automation",
    directory: "apps/operations",
  });
  const directory = await mkdtemp(join(tmpdir(), "xstack-custom-meter-"));
  try {
    const modulePath = join(directory, "meter.ts");
    // This module exists only after generation in a unique runtime-selected temporary directory.
    await writeFile(modulePath, files.get("packages/custom-meter/src/index.ts")!);
    const generated = await import(pathToFileURL(modulePath).href);
    expect(generated.charge(6)).toEqual({ units: 42, provider: "local" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const invalid = structuredClone(declaration);
  invalid.presets[0]!.productPreset = "missing-product";
  expect(() =>
    createBuilderCatalog(invalid, readModuleCatalog(templates), readProductPresets(templates)),
  ).toThrow("Unknown product preset missing-product");
});

test("unavailable custom modules survive state loading and produce diagnostics instead of disappearing", () => {
  const input = StackStateSchema.parse({
    ...DEFAULT_STACK,
    apps: undefined,
    features: ["removed-custom-module"],
  });
  const result = resolveStackCompatibility(input);
  expect(result.stack.features).toEqual(["removed-custom-module"]);
  expect(result.notes.features?.notes).toContain('Unknown feature module "removed-custom-module"');
});
