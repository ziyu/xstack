import { describe, expect, it } from "bun:test";

import type { ProductConfig, ProjectConfig } from "@xstack/types";

import { VirtualFileSystem } from "../src/core/virtual-fs";
import { generate } from "../src/generator";
import { MODULE_CATALOG } from "../src/modules/catalog";
import { toRenderConfig } from "../src/modules/pipeline";
import { PRODUCT_PRESETS } from "../src/modules/presets";
import { hasErrors, resolveModules, toSelection } from "../src/modules/resolver";
import { replaceStackFiles } from "../src/modules/seams";
import type { StackContext } from "../src/modules/types";
import { EMBEDDED_TEMPLATES } from "../src/templates.generated";
import type { VirtualNode } from "../src/types";

const NEXT_STACK: StackContext = {
  projectName: "app",
  frontend: ["next"],
  backend: "self",
  database: "sqlite",
  orm: "drizzle",
  api: "none",
  webDeploy: "none",
};

function config(product: ProductConfig | undefined, overrides: Partial<ProjectConfig> = {}) {
  return {
    ...NEXT_STACK,
    projectDir: "/tmp/app",
    relativePath: "app",
    runtime: "none",
    addons: ["turborepo"],
    git: false,
    packageManager: "bun",
    install: false,
    dbSetup: "none",
    serverDeploy: "none",
    product,
    ...overrides,
  } satisfies ProjectConfig;
}

function plan(product: ProductConfig, stack: Partial<StackContext> = {}) {
  return resolveModules(toSelection(product), { ...NEXT_STACK, ...stack }, MODULE_CATALOG);
}

function variants(product: ProductConfig, stack: Partial<StackContext> = {}) {
  return Object.fromEntries(plan(product, stack).modules.map((m) => [m.manifest.id, m.variant]));
}

function paths(node: VirtualNode, prefix = ""): string[] {
  if (node.type === "file") return [prefix];
  return node.children.flatMap((child) =>
    paths(child, prefix ? `${prefix}/${child.name}` : child.name),
  );
}

async function generatedFiles(project: ProjectConfig) {
  const result = await generate({ config: project, templates: EMBEDDED_TEMPLATES });
  if (result.isErr()) throw result.error;
  return paths(result.value.root).sort();
}

describe("module resolver", () => {
  it("renders every module natively on the next shell stack", () => {
    expect(variants(PRODUCT_PRESETS["saas-global"])).toEqual({
      i18n: "native",
      core: "native",
      auth: "native",
      email: "native",
      admin: "native",
      payment: "native",
      credits: "native",
    });
  });

  it("adds the shell only when it is supported", () => {
    expect(Object.keys(variants({ features: [] }))).toEqual(["i18n", "core"]);
    expect(variants({ features: [] }, { api: "trpc", backend: "hono" })).toEqual({});
  });

  it("falls back to the stack templates outside the native stack", () => {
    const result = plan({ features: ["auth"] }, { frontend: ["svelte"], api: "orpc" });
    expect(hasErrors(result)).toBe(false);
    expect(result.modules.map((m) => [m.manifest.id, m.variant])).toEqual([["auth", "stack"]]);
    expect(result.modules[0]!.providers).toEqual([]);
    expect(result.domains).toEqual({ auth: "better-auth" });
  });

  it("resolves polar as a native payment provider", () => {
    const result = plan({ features: ["payment"], providers: { payment: ["polar"] } });
    expect(hasErrors(result)).toBe(false);
    expect(variants({ features: ["payment"], providers: { payment: ["polar"] } })).toEqual({
      auth: "native",
      core: "native",
      i18n: "native",
      payment: "native",
    });
    expect(result.modules.find((m) => m.manifest.id === "payment")!.providers).toEqual(["polar"]);
    expect(result.domains).toEqual({ auth: "better-auth" });
  });

  it("rejects payments outside the native stack", () => {
    const result = plan({ features: ["payment"] }, { api: "orpc" });
    expect(result.issues.filter((i) => i.level === "error").map((i) => i.module)).toContain(
      "payment",
    );
  });

  it("rejects native-only modules next to a stack fallback", () => {
    const result = plan({
      features: ["auth", "email"],
      options: { auth: { engine: "clerk" } },
    });
    expect(result.issues.filter((i) => i.level === "error").map((i) => i.module)).toEqual([
      "email",
    ]);
  });

  it("rejects providers the stack templates do not offer", () => {
    const result = plan({ features: ["auth"], providers: { auth: ["github"] } }, { api: "orpc" });
    expect(result.issues.map((i) => i.message)).toContain(
      'Provider "auth.github" is not available with the stack templates',
    );
  });

  it("allows WeChat only through native authentication", () => {
    const product = { features: ["auth"], providers: { auth: ["wechat"] } };
    const native = plan(product);
    expect(hasErrors(native)).toBe(false);
    expect(native.modules.find((module) => module.manifest.id === "auth")?.providers).toEqual([
      "wechat",
    ]);
    expect(hasErrors(plan(product, { frontend: ["nuxt"] }))).toBe(true);
    expect(hasErrors(plan({ ...product, options: { auth: { engine: "clerk" } } }))).toBe(true);
  });

  it("enables phone authentication only with the SMS integration", () => {
    const selected = plan({ features: ["auth", "sms"], providers: { sms: ["aliyun"] } });
    expect(selected.issues.filter((issue) => issue.level === "error")).toEqual([]);
    expect(
      selected.modules.find((module) => module.manifest.id === "auth")?.integrations,
    ).toContain("sms");
    expect(selected.modules.find((module) => module.manifest.id === "sms")?.integrations).toContain(
      "auth",
    );
    expect(
      plan({ features: ["sms"] }).modules.some((module) => module.manifest.id === "auth"),
    ).toBe(false);
    expect(
      plan({ features: ["auth"] }).modules.some((module) => module.manifest.id === "sms"),
    ).toBe(false);
  });

  it("rejects multiple SMS providers and non-native authentication combinations", () => {
    for (const selection of [
      { features: ["sms"], providers: { sms: ["aliyun", "twilio"] } },
      { features: ["sms"], providers: { sms: [] } },
      { features: ["auth", "sms"], options: { auth: { engine: "clerk" } } },
    ]) {
      expect(hasErrors(plan(selection))).toBe(true);
    }
    expect(hasErrors(plan({ features: ["sms"] }, { frontend: ["nuxt"] }))).toBe(true);
    expect(hasErrors(plan({ features: ["sms"] }, { webDeploy: "cloudflare" }))).toBe(true);
  });
});

describe("module seams", () => {
  it("refuses to replace stack files that no longer exist", () => {
    const vfs = new VirtualFileSystem();
    vfs.writeFile("apps/web/src/app/page.tsx", "");
    expect(replaceStackFiles(vfs, "core", ["apps/web/src/app/page.tsx"])).toEqual([
      "apps/web/src/app/page.tsx",
    ]);
    expect(() => replaceStackFiles(vfs, "core", ["apps/web/src/app/page.tsx"])).toThrow(
      "no longer generate",
    );
  });

  it("refuses module templates that overwrite undeclared stack files", async () => {
    const templates = new Map(EMBEDDED_TEMPLATES);
    templates.set("modules/core/files/apps/web/src/components/mode-toggle.tsx", "");
    const result = await generate({ config: config({ features: [] }), templates });
    expect(result.isErr() && result.error.message).toContain('declare it in "replaces"');
  });

  it("derives the stack's auth engine from the plan", () => {
    const render = toRenderConfig(
      config({ features: ["auth"] }, { frontend: ["svelte"], api: "orpc" }),
    );
    expect(render.auth).toBe("better-auth");
  });
});

describe("generated product layout", () => {
  for (const [name, product, overrides] of [
    ["shell", { features: [] }, {}],
    ["starter", PRODUCT_PRESETS.starter, { database: "postgres" }],
    ["saas-global", PRODUCT_PRESETS["saas-global"], { webDeploy: "docker" }],
  ] as const) {
    it(`matches the ${name} file list`, async () => {
      expect(await generatedFiles(config(product, overrides))).toMatchSnapshot();
    });
  }
});
