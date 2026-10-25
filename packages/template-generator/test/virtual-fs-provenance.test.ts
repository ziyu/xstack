import { expect, test } from "bun:test";

import type { ProjectConfig } from "@xstack/types";

import { VirtualFileSystem } from "../src/core/virtual-fs";
import { processSingleTemplate, processTemplatesFromPrefix } from "../src/template-handlers/utils";
import { GeneratorError, type GenerationSource } from "../src/types";

const template: GenerationSource = { kind: "template", name: "apps/fullstack-web/page.ts.hbs" };
const replacement: GenerationSource = { kind: "processor", name: "replace-stack-files" };
const postprocessor: GenerationSource = { kind: "processor", name: "format-output" };
const config: ProjectConfig = {
  projectName: "provenance-check",
  projectDir: "/tmp/provenance-check",
  relativePath: "provenance-check",
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
  addons: [],
  git: false,
  install: false,
};

test("provenance is opt-in and disabled scopes preserve original errors", async () => {
  const vfs = new VirtualFileSystem();
  const failure = new Error("original failure");
  vfs.withSource(template, () => vfs.writeFile("page.ts", "private content"));
  await vfs.withSourceAsync(postprocessor, async () => {
    await Promise.resolve();
    vfs.writeFile("page.ts", "updated private content");
  });
  vfs.importProvenance([{ path: "page.ts", operation: "create", source: template }]);
  expect(vfs.getProvenance()).toEqual([]);
  expect(() =>
    vfs.withSource(template, () => {
      throw failure;
    }),
  ).toThrow(failure);
  expect(vfs.readFile("page.ts")).toBe("updated private content");
});

test("writes and replacements retain their physical-path source chain without content", () => {
  const vfs = new VirtualFileSystem({ "apps/web": "apps/store" }, undefined, { trace: true });
  const path = "apps/store/page.ts";
  vfs.withSource(template, () => vfs.writeFile("apps/web/page.ts", "secret"));
  vfs.withSource(postprocessor, () => vfs.writeFile("apps/web/page.ts", "secret"));
  vfs.withSource(replacement, () => {
    expect(vfs.deleteFile("apps/web/page.ts")).toBe(true);
    expect(vfs.deleteFile("apps/web/page.ts")).toBe(false);
  });
  vfs.withSource(template, () => vfs.writeFile("apps/web/page.ts", "replacement secret"));
  expect(vfs.getProvenance()).toEqual([
    { path, operation: "create", source: template },
    { path, operation: "update", source: postprocessor, previousSource: template },
    { path, operation: "delete", source: replacement, previousSource: postprocessor },
    { path, operation: "create", source: template, previousSource: replacement },
  ]);
  expect(JSON.stringify(vfs.getProvenance())).not.toContain("secret");
  const snapshot = vfs.getProvenance();
  snapshot[0]!.source.name = "changed";
  snapshot.pop();
  expect(vfs.getProvenance()[0]!.source).toEqual(template);
  expect(vfs.getProvenance()).toHaveLength(4);
});

test("nested synchronous and awaited scopes restore app and ownership context after failures", async () => {
  const initial: GenerationSource = {
    kind: "processor",
    name: "application",
    app: "store",
    owner: "store",
  };
  const vfs = new VirtualFileSystem({}, undefined, { trace: true, source: initial });
  const failure = new Error("failed template");
  let reported: unknown;
  vfs.withSource(postprocessor, () => {
    try {
      vfs.withSource(template, () => {
        throw failure;
      });
    } catch (error) {
      reported = error;
    }
    vfs.writeFile("outer.ts", "outer");
  });
  expect(reported).toBeInstanceOf(GeneratorError);
  expect(reported).toMatchObject({
    phase: "template",
    cause: failure,
    source: { ...template, app: "store", owner: "store" },
  });
  const domainError = new GeneratorError({
    phase: "modules",
    message: "missing seam",
    cause: failure,
  });
  let asyncFailure: unknown;
  try {
    await vfs.withSourceAsync(postprocessor, async () => {
      await Promise.resolve();
      await vfs.withSourceAsync(template, async () => {
        await Promise.resolve();
        vfs.writeFile("awaited.ts", "awaited");
        throw domainError;
      });
    });
  } catch (error) {
    asyncFailure = error;
  }
  expect(asyncFailure).toMatchObject({
    phase: "modules",
    message: "missing seam",
    cause: failure,
    source: { ...template, app: "store", owner: "store" },
  });
  vfs.writeFile("restored.ts", "restored");
  expect(vfs.getProvenance().map((write) => write.source)).toEqual([
    { ...postprocessor, app: "store", owner: "store" },
    { ...template, app: "store", owner: "store" },
    initial,
  ]);
});

test("ownership violations carry the current source but never record a successful write", () => {
  const vfs = new VirtualFileSystem(
    {},
    { ownsPath: (path) => path.startsWith("apps/store/") },
    { trace: true },
  );
  let failure: unknown;
  try {
    vfs.withSource({ ...postprocessor, app: "store", owner: "store" }, () => {
      vfs.writeFile("packages/db/schema.ts", "not owned");
    });
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({
    phase: "ownership",
    source: { ...postprocessor, app: "store", owner: "store" },
  });
  expect(vfs.getProvenance()).toEqual([]);
  expect(vfs.fileExists("packages/db/schema.ts")).toBe(false);
});

test("inherited manifests do not invent previous writers and clear resets the trace", () => {
  const vfs = new VirtualFileSystem(
    {},
    {
      ownsPath: () => true,
      inheritedFiles: new Map([["packages/db/package.json", '{"name":"inherited"}']]),
    },
    { trace: true },
  );
  expect(vfs.readJson("packages/db/package.json")).toEqual({ name: "inherited" });
  expect(vfs.getAllFiles()).toEqual([]);
  vfs.withSource(postprocessor, () => vfs.writeJson("packages/db/package.json", { name: "owned" }));
  expect(vfs.getProvenance()).toEqual([
    { path: "packages/db/package.json", operation: "create", source: postprocessor },
  ]);
  vfs.clear();
  expect(vfs.getProvenance()).toEqual([]);
  expect(vfs.getAllFiles()).toEqual([]);
  vfs.withSource(template, () => vfs.writeFile("packages/db/package.json", "{}"));
  expect(vfs.getProvenance()).toEqual([
    { path: "packages/db/package.json", operation: "create", source: template },
  ]);
});

test("merging traced output preserves previous sources without duplicate copy writes", () => {
  const app = new VirtualFileSystem({}, undefined, { trace: true });
  const root = new VirtualFileSystem({}, undefined, { trace: true });
  app.withSource(template, () => app.writeFile("apps/store/page.ts", "page"));
  root.withoutTracing(() => {
    root.withoutTracing(() =>
      root.writeFile("apps/store/page.ts", app.readFile("apps/store/page.ts")!),
    );
  });
  root.importProvenance(app.getProvenance());
  root.withSource(postprocessor, () => root.writeFile("apps/store/page.ts", "formatted page"));
  expect(root.getProvenance()).toEqual([
    { path: "apps/store/page.ts", operation: "create", source: template },
    {
      path: "apps/store/page.ts",
      operation: "update",
      source: postprocessor,
      previousSource: template,
    },
  ]);
  expect(() =>
    root.withoutTracing(() => {
      throw new Error("copy failed");
    }),
  ).toThrow("copy failed");
  root.withSource(postprocessor, () => root.writeFile("after-copy.ts", "restored"));
  expect(root.getProvenance().at(-1)).toEqual({
    path: "after-copy.ts",
    operation: "create",
    source: postprocessor,
  });
});

test("text and binary template origins remain separate from binary transport metadata", () => {
  const vfs = new VirtualFileSystem({}, undefined, {
    trace: true,
    source: { kind: "processor", name: "application", app: "store", owner: "store" },
  });
  const templates = new Map([
    ["layer/page.ts.hbs", "export const name = '{{projectName}}';"],
    ["layer/plain.txt", "plain text"],
    ["layer/icon.png", "binary transport"],
  ]);
  processTemplatesFromPrefix(vfs, templates, "layer", "apps/store", config);
  processSingleTemplate(vfs, templates, "layer/page.ts", "apps/store/single.ts", config);
  expect(vfs.readFile("apps/store/page.ts")).toContain(config.projectName);
  expect(vfs.getProvenance().map((write) => write.source)).toEqual([
    { kind: "template", name: "layer/page.ts.hbs", app: "store", owner: "store" },
    { kind: "template", name: "layer/plain.txt", app: "store", owner: "store" },
    { kind: "template", name: "layer/icon.png", app: "store", owner: "store" },
    { kind: "template", name: "layer/page.ts.hbs", app: "store", owner: "store" },
  ]);
  const apps = vfs.toTree().children[0]!;
  expect(apps.type).toBe("directory");
  if (apps.type !== "directory") throw new Error("missing apps directory");
  const store = apps.children[0]!;
  if (store.type !== "directory") throw new Error("missing store directory");
  expect(store.children.find((node) => node.name === "page.ts")).not.toHaveProperty("sourcePath");
  expect(store.children.find((node) => node.name === "icon.png")).toMatchObject({
    content: "[Binary file]",
    sourcePath: "layer/icon.png",
  });
  vfs.withSource(postprocessor, () => vfs.writeFile("apps/store/icon.png", "now text"));
  const overwrittenApps = vfs.toTree().children[0]!;
  if (overwrittenApps.type !== "directory") throw new Error("missing apps directory");
  const overwrittenStore = overwrittenApps.children[0]!;
  if (overwrittenStore.type !== "directory") throw new Error("missing store directory");
  expect(overwrittenStore.children.find((node) => node.name === "icon.png")).not.toHaveProperty(
    "sourcePath",
  );
});

test("template compilation failures report the actual text source and restore the processor", () => {
  const vfs = new VirtualFileSystem({}, undefined, { trace: true, source: postprocessor });
  const source = "layer/broken.ts.hbs";
  let failure: unknown;
  try {
    processTemplatesFromPrefix(
      vfs,
      new Map([[source, "{{#if projectName}}"]]),
      "layer",
      "out",
      config,
    );
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(GeneratorError);
  expect(failure).toMatchObject({ phase: "template", source: { kind: "template", name: source } });
  expect(vfs.getProvenance()).toEqual([]);
  vfs.writeFile("recovered.ts", "recovered");
  expect(vfs.getProvenance()).toEqual([
    { path: "recovered.ts", operation: "create", source: postprocessor },
  ]);
});

test("binary transport metadata survives importing traced output", () => {
  const source: GenerationSource = { kind: "template", name: "layer/icon.png" };
  const app = new VirtualFileSystem({}, undefined, { trace: true });
  const root = new VirtualFileSystem({}, undefined, { trace: true });
  app.withSource(source, () => app.writeFile("icon.png", "[Binary file]", source.name));
  const file = app.toTree().children[0]!;
  if (file.type !== "file") throw new Error("missing binary output");
  root.withoutTracing(() => root.writeFile(file.path, file.content, file.sourcePath));
  root.importProvenance(app.getProvenance());
  expect(root.toTree().children).toEqual([file]);
  expect(root.getProvenance()).toEqual([{ path: "icon.png", operation: "create", source }]);
  root.withSource(replacement, () => root.deleteFile("icon.png"));
  root.withSource(postprocessor, () => root.writeFile("icon.png", "replacement text"));
  expect(root.toTree().children[0]).not.toHaveProperty("sourcePath");
  expect(root.getProvenance().at(-1)).toEqual({
    path: "icon.png",
    operation: "create",
    source: postprocessor,
    previousSource: replacement,
  });
});
