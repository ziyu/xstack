import { describe, expect, it } from "bun:test";
import path from "node:path";

import fs from "fs-extra";

import type { CreateInput } from "../src";
import { create } from "../src";
import { productFromFlags } from "../src/helpers/core/product-mode";
import { SMOKE_DIR } from "./setup";

const baseInput = {
  git: false,
  install: false,
  packageManager: "bun",
  directoryConflict: "overwrite",
  disableAnalytics: true,
} satisfies Partial<CreateInput>;

async function createProduct(projectName: string, options: Partial<CreateInput>) {
  const projectDir = path.join(SMOKE_DIR, projectName);
  const result = await create(projectDir, { ...baseInput, ...options });
  const read = (file: string) => fs.readFile(path.join(projectDir, file), "utf8");
  const exists = (file: string) => fs.pathExists(path.join(projectDir, file));
  return { result, read, exists };
}

describe("product mode", () => {
  it("scaffolds the foundation and auth modules from the starter preset", async () => {
    const { result, read, exists } = await createProduct("product-starter", {
      preset: "starter",
    });
    expect(result.isOk()).toBe(true);

    for (const file of [
      "apps/web/src/app/[lang]/layout.tsx",
      "apps/web/src/app/[lang]/dashboard/page.tsx",
      "apps/web/src/app/[lang]/login/page.tsx",
      "apps/web/src/app/[lang]/dashboard/settings/page.tsx",
      "apps/web/src/proxy.ts",
      "apps/web/src/config/navigation.ts",
      "packages/auth/src/index.ts",
      "packages/events/package.json",
      "packages/i18n/src/messages/zh-CN/index.ts",
      "docs/modules/i18n.md",
      "docs/modules/auth.md",
    ]) {
      expect(await exists(file)).toBe(true);
    }
    expect(await exists("apps/web/src/app/page.tsx")).toBe(false);
    expect(await exists("apps/web/src/components/header.tsx")).toBe(false);
    expect(await exists("apps/web/src/app/[lang]/forgot-password/page.tsx")).toBe(false);

    const services = await read("apps/web/src/services.ts");
    expect(services).toContain("export const events = createEventBus()");
    expect(services).toContain("export const auth = createAuth(ENV, db, events)");
    expect(services).toContain("export const services = {");

    const xstackConfig = await read("xstack.jsonc");
    expect(xstackConfig).toContain('"features": [');
    expect(xstackConfig).toContain('"auth"');
    expect(xstackConfig).toContain('"database": "sqlite"');
  });

  it("wires the saas-global modules together", async () => {
    const { result, read, exists } = await createProduct("product-saas-global", {
      preset: "saas-global",
      product: { features: [], options: { credits: { signupBonus: 50 } } },
    });
    expect(result.isOk()).toBe(true);

    for (const file of [
      "apps/web/src/app/[lang]/forgot-password/page.tsx",
      "apps/web/src/app/[lang]/admin/users/page.tsx",
      "apps/web/src/app/[lang]/admin/orders/page.tsx",
      "apps/web/src/app/[lang]/admin/credits/page.tsx",
      "apps/web/src/app/[lang]/pricing/page.tsx",
      "apps/web/src/app/[lang]/dashboard/credits/page.tsx",
      "apps/web/src/app/api/payment/webhook/[provider]/route.ts",
      "packages/payment/src/providers/stripe.ts",
      "packages/email/src/providers/resend.ts",
      "packages/db/src/schema/credits.ts",
    ]) {
      expect(await exists(file)).toBe(true);
    }
    expect(await exists("apps/web/src/app/api/payment/mock/route.ts")).toBe(false);

    const services = await read("apps/web/src/services.ts");
    for (const register of [
      "registerAuthEmail",
      "registerPaymentCredits",
      "registerCreditsSignup",
    ]) {
      expect(services).toContain(`${register}(services);`);
    }
    expect(await read("apps/web/src/integrations/credits-signup.ts")).toContain(
      "const SIGNUP_BONUS = 50;",
    );
    expect(await read("apps/web/src/config/navigation.ts")).toContain('"/admin/credits"');
    const schema = await read("apps/web/.env.schema");
    expect(schema).toContain("STRIPE_SECRET_KEY");
    expect(schema).toContain("# @sensitive=false @type=url\nBETTER_AUTH_URL=");
    expect(await read("README.md")).toContain("[docs](docs/modules/credits.md)");
  });

  it("honors database, deploy and locale choices", async () => {
    const { result, read, exists } = await createProduct("product-postgres-docker", {
      product: { features: [], options: { i18n: { locales: "zh-CN" } } },
      database: "postgres",
      webDeploy: "docker",
    });
    expect(result.isOk()).toBe(true);

    expect(await exists("apps/web/Dockerfile")).toBe(true);
    expect(await read("packages/i18n/src/config.ts")).toContain('defaultLocale: Locale = "zh-CN"');
    expect(await read("packages/i18n/src/messages/index.ts")).not.toContain("./en");

    const xstackConfig = await read("xstack.jsonc");
    expect(xstackConfig).toContain('"database": "postgres"');
    expect(xstackConfig).toContain('"webDeploy": "docker"');
    expect(xstackConfig).toContain('"backend": "self"');
    expect(xstackConfig).toContain("--module-options i18n.locales=zh-CN");
  });

  it("falls back to the stack templates where native modules cannot run", async () => {
    const { result, read, exists } = await createProduct("product-starter-mongodb", {
      preset: "starter",
      database: "mongodb",
      orm: "mongoose",
    });
    expect(result.isOk()).toBe(true);
    expect(await exists("apps/web/src/app/[lang]/layout.tsx")).toBe(false);
    expect(await exists("apps/web/src/components/sign-in-form.tsx")).toBe(true);
    expect(await read("xstack.jsonc")).not.toContain('"auth":');
  });

  it("rejects native-only modules on stacks they cannot support", async () => {
    const { result } = await createProduct("product-unsupported-db", {
      preset: "saas-global",
      database: "mongodb",
      orm: "mongoose",
    });
    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error.message).toContain("stack templates");
  });

  it("renders polar as a native payment provider", async () => {
    const { result, read, exists } = await createProduct("product-polar", {
      product: { features: ["payment"], providers: { payment: ["polar"] } },
    });
    expect(result.isOk()).toBe(true);
    expect(await exists("packages/payment/src/providers/polar.ts")).toBe(true);
    expect(await exists("packages/payment/src/providers/stripe.ts")).toBe(false);
    expect(await read("packages/payment/package.json")).toContain('"@polar-sh/sdk"');
    expect(await read("apps/web/.env.schema")).toContain("POLAR_WEBHOOK_SECRET");
    expect(await exists("packages/auth/src/lib/payments.ts")).toBe(false);
    expect(await read("xstack.jsonc")).toContain("--features payment --providers payment:polar");
  });

  it("rejects payments on stacks outside the product shell", async () => {
    const { result } = await createProduct("product-polar-svelte", {
      frontend: ["svelte"],
      api: "orpc",
      product: { features: ["payment"], providers: { payment: ["polar"] } },
    });
    expect(result.isErr()).toBe(true);
  });

  it("renders the product shell without auth when no features are selected", async () => {
    const { result, read, exists } = await createProduct("product-shell-only", {
      product: { features: [] },
    });
    expect(result.isOk()).toBe(true);
    expect(await exists("apps/web/src/app/[lang]/page.tsx")).toBe(true);
    expect(await exists("packages/auth/package.json")).toBe(false);
    expect(await read("apps/web/src/components/site-header.tsx")).not.toContain("authClient");
  });

  it("parses --providers lists that share a feature prefix", () => {
    const result = productFromFlags({
      features: ["auth,payment"],
      providers: ["payment:stripe,mock,auth:github"],
    });
    expect(result.isOk() && result.value?.providers).toEqual({
      payment: ["stripe", "mock"],
      auth: ["github"],
    });
    expect(productFromFlags({ providers: ["stripe"] }).isErr()).toBe(true);
  });

  it("preserves an explicitly disabled OAuth selection and rejects mixed none providers", async () => {
    const parsed = productFromFlags({ features: ["auth"], providers: ["auth:none"] });
    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) throw parsed.error;
    expect(parsed.value?.providers?.auth).toEqual([]);
    const { result, read } = await createProduct("product-email-password-only", {
      product: parsed.value,
    });
    expect(result.isOk()).toBe(true);
    expect(await read("apps/web/.env.schema")).not.toContain("GOOGLE_CLIENT_ID");
    expect(await read("apps/web/.env.schema")).not.toContain("GITHUB_CLIENT_ID");
    expect(productFromFlags({ providers: ["auth:none,github"] }).isErr()).toBe(true);
    expect(productFromFlags({ providers: ["auth:github,none"] }).isErr()).toBe(true);
  });

  it("rejects unknown features", async () => {
    const { result } = await createProduct("product-unknown-feature", {
      product: { features: ["teleport"] },
    });
    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error.message).toContain("teleport");
  });
});
