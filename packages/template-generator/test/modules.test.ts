import { describe, expect, it } from "bun:test";

import type { ProductConfig, ProjectConfig } from "@xstack/types";

import { resolveWorkspaceCapabilities } from "../src/contributions/capabilities";
import { VirtualFileSystem } from "../src/core/virtual-fs";
import { generate } from "../src/generator";
import { MODULE_CATALOG, readModuleCatalog } from "../src/modules/catalog";
import { toRenderConfig } from "../src/modules/pipeline";
import { PRODUCT_PRESETS } from "../src/modules/presets";
import { hasErrors, resolveModules, toSelection } from "../src/modules/resolver";
import { replaceStackFiles } from "../src/modules/seams";
import type { StackContext } from "../src/modules/types";
import { EMBEDDED_TEMPLATES } from "../src/templates.generated";
import { dependencyVersionMap } from "../src/utils/add-deps";

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
    expect(variants(PRODUCT_PRESETS["saas-cn"])).toEqual({
      i18n: "native",
      core: "native",
      auth: "native",
      sms: "native",
      admin: "native",
      payment: "native",
      credits: "native",
      storage: "native",
    });
  });

  it("adds the shell only when it is supported", () => {
    expect(Object.keys(variants({ features: [] }))).toEqual(["i18n", "core"]);
    expect(variants({ features: [] }, { api: "trpc", backend: "hono" })).toEqual({});
  });

  it("requires one storage provider and an owned native database", () => {
    for (const providers of [[], ["oss", "cos"]]) {
      expect(hasErrors(plan({ features: ["storage"], providers: { storage: providers } }))).toBe(
        true,
      );
    }
    for (const stack of [
      { frontend: ["svelte"] as ["svelte"] },
      { database: "none" as const },
      { orm: "prisma" as const },
    ]) {
      expect(
        hasErrors(plan({ features: ["storage"], providers: { storage: ["oss"] } }, stack)),
      ).toBe(true);
    }
  });

  it("uses Workers defaults only for omitted providers and rejects explicit incompatible choices", () => {
    const stack = { webDeploy: "cloudflare", dbSetup: "d1" } as const;
    const defaulted = plan({ features: ["storage"] }, stack);
    expect(hasErrors(defaulted)).toBe(false);
    expect(defaulted.modules.find((module) => module.manifest.id === "storage")?.providers).toEqual(
      ["r2-binding"],
    );
    expect(hasErrors(plan({ features: ["storage"], providers: { storage: ["oss"] } }, stack))).toBe(
      true,
    );
    expect(hasErrors(plan({ features: ["storage"] }, { ...stack, dbSetup: "none" }))).toBe(true);
    expect(hasErrors(plan({ features: ["storage"], providers: { storage: ["r2-binding"] } }))).toBe(
      true,
    );
  });

  it("rejects fractional credit costs and out-of-range referral rewards", () => {
    expect(hasErrors(plan({ features: ["ai"], options: { ai: { chatCost: 0.5 } } }))).toBe(true);
    expect(
      hasErrors(
        plan({ features: ["affiliate"], options: { affiliate: { commissionPercent: 101 } } }),
      ),
    ).toBe(true);
  });

  it("resolves the same full feature selection on supported native frameworks", () => {
    for (const frontend of ["next", "tanstack-start", "nuxt"] as const) {
      const selected = plan(PRODUCT_PRESETS.full, { frontend: [frontend] });
      expect(selected.issues.filter((issue) => issue.level === "error")).toEqual([]);
      expect(selected.modules.filter((module) => module.variant !== "native")).toEqual([]);
      expect(selected.modules.map((module) => module.manifest.id).sort()).toEqual(
        [...PRODUCT_PRESETS.full.features, "core", "i18n"].sort(),
      );
    }
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
    expect(hasErrors(plan(product, { frontend: ["svelte"] }))).toBe(true);
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
    expect(hasErrors(plan({ features: ["sms"] }, { frontend: ["svelte"] }))).toBe(true);
    expect(
      hasErrors(
        plan({ features: ["sms"], providers: { sms: ["aliyun"] } }, { webDeploy: "cloudflare" }),
      ),
    ).toBe(true);
    expect(
      hasErrors(
        plan({ features: ["sms"], providers: { sms: ["twilio"] } }, { webDeploy: "cloudflare" }),
      ),
    ).toBe(false);
  });
});

describe("module seams", () => {
  it("refuses to replace stack files that no longer exist", () => {
    const vfs = new VirtualFileSystem();
    vfs.writeFile("apps/web/src/app/page.tsx", "");
    expect(
      replaceStackFiles(vfs, "core", ["apps/web/src/app/page.tsx"], config(undefined)),
    ).toEqual(["apps/web/src/app/page.tsx"]);
    expect(() =>
      replaceStackFiles(vfs, "core", ["apps/web/src/app/page.tsx"], config(undefined)),
    ).toThrow("no longer generate");
  });

  it("refuses module templates that overwrite undeclared stack files", async () => {
    const templates = new Map(EMBEDDED_TEMPLATES);
    templates.set("modules/core/files/apps/fullstack-web/src/components/mode-toggle.tsx", "");
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

describe("template-owned module declarations", () => {
  const declaration = {
    id: "audit-journal",
    name: { en: "Audit journal", "zh-CN": "审计日志" },
    description: { en: "Custom audit journal", "zh-CN": "自定义审计日志" },
    category: "operations",
    providers: {
      min: 1,
      max: 1,
      default: { global: ["local"], cn: ["local"] },
      options: { local: { name: "Local journal", market: "any" } },
    },
    options: { retention: { type: "number", default: 30, min: 1, integer: true } },
    packages: [{ dir: "audit-journal", dependencies: { zod: "$dependency:zod" } }],
    sources: {
      providers: { mode: "inline", source: "files/packages/audit-journal/src/index.ts.hbs" },
    },
  };

  it("discovers, validates and generates a new module entirely from supplied templates", async () => {
    const templates = new Map(EMBEDDED_TEMPLATES);
    templates.set("modules/audit-journal/module.json", JSON.stringify(declaration));
    templates.set(
      "modules/audit-journal/files/packages/audit-journal/src/index.ts.hbs",
      'export const retention = {{module.options.retention}}; export const provider = "{{module.providers.[0]}}";',
    );
    const product = {
      features: ["audit-journal"],
      providers: { "audit-journal": ["local"] },
      options: { "audit-journal": { retention: 90 } },
    };
    const catalog = readModuleCatalog(templates);
    expect(MODULE_CATALOG.has("audit-journal")).toBe(false);
    expect(catalog.get("audit-journal")?.packages?.[0]?.dependencies?.zod).toBe(
      dependencyVersionMap.zod,
    );
    expect(resolveWorkspaceCapabilities(config(product), templates).issues).toEqual([]);
    const selected = resolveModules(toSelection(product), NEXT_STACK, catalog);
    expect(selected.issues).toEqual([]);
    const result = await generate({ config: config(product), templates });
    if (result.isErr()) throw result.error;
    const pending = [...result.value.root.children];
    const files = new Map<string, string>();
    while (pending.length) {
      const node = pending.pop()!;
      if (node.type === "file") files.set(node.path, node.content);
      else pending.push(...node.children);
    }
    expect(files.get("packages/audit-journal/src/index.ts")).toContain("retention = 90");
    expect(files.get("packages/audit-journal/src/index.ts")).toContain('provider = "local"');
    const invalid = await generate({
      config: config({ ...product, providers: { "audit-journal": ["missing"] } }),
      templates,
    });
    expect(invalid.isErr() && invalid.error.message).toContain('Unknown provider "missing"');
    const invalidOption = await generate({
      config: config({ ...product, options: { "audit-journal": { retention: 0 } } }),
      templates,
    });
    expect(invalidOption.isErr() && invalidOption.error.message).toContain(
      'Option "audit-journal.retention"',
    );
    templates.delete("modules/audit-journal/files/packages/audit-journal/src/index.ts.hbs");
    const absentSource = await generate({ config: config(product), templates });
    expect(absentSource.isErr() && absentSource.error.message).toContain("missing-contribution");
  });

  it("uses supplied declarations rather than silently restoring the built-in catalog", () => {
    const templates = new Map([["modules/audit-journal/module.json", JSON.stringify(declaration)]]);
    const catalog = readModuleCatalog(templates);
    expect([...catalog.keys()]).toEqual(["audit-journal"]);
    expect(
      resolveModules(toSelection({ features: ["auth"] }), NEXT_STACK, catalog).issues,
    ).toContainEqual(expect.objectContaining({ message: 'Unknown feature module "auth"' }));
  });

  it("enforces template-owned foundation support without a canonical module name", () => {
    const metadata = {
      ...declaration,
      hidden: true,
      providers: undefined,
      requiredWhen: { frameworks: ["next"], backends: ["self"], apis: ["none"] },
      supports: { orms: ["drizzle"], dialects: ["postgres"] },
    };
    const templates = new Map([["modules/audit-journal/module.json", JSON.stringify(metadata)]]);
    const invalid = resolveWorkspaceCapabilities(config({ features: [] }), templates);
    expect(invalid.issues).toContain(
      'web: Module "audit-journal" requires one of these databases: postgres',
    );
    expect(
      resolveWorkspaceCapabilities(config({ features: [] }, { database: "postgres" }), templates)
        .issues,
    ).toEqual([]);
    expect(
      resolveWorkspaceCapabilities(config({ features: [] }, { frontend: ["svelte"] }), templates)
        .issues,
    ).toEqual([]);
  });

  it("does not impose native foundation requirements on a stack fallback", () => {
    const fallback = plan(PRODUCT_PRESETS.starter, { database: "mongodb", orm: "mongoose" });
    expect(fallback.issues.filter((issue) => issue.level === "error")).toEqual([]);
    expect(fallback.modules.map((module) => [module.manifest.id, module.variant])).toEqual([
      ["auth", "stack"],
    ]);
  });

  it("reports malformed declarations and unknown version references with their metadata path", () => {
    const path = "modules/audit-journal/module.json";
    for (const manifest of [
      { ...declaration, options: { retention: { type: "number", default: "invalid" } } },
      {
        ...declaration,
        packages: [{ dir: "audit-journal", dependencies: { zod: "$dependency:unknown-package" } }],
      },
      { ...declaration, id: "different-directory" },
    ]) {
      expect(() => readModuleCatalog(new Map([[path, JSON.stringify(manifest)]]))).toThrow(path);
    }
  });
});
