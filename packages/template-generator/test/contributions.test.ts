import { expect, test } from "bun:test";

import {
  assertContributionInventory,
  inventoryContributions,
  queryContributions,
  validateContributionRequirements,
} from "../src/contributions/inventory";
import { requiredModuleContributions } from "../src/contributions/requirements";
import { MODULE_CATALOG } from "../src/modules/catalog";
import { PRODUCT_PRESETS } from "../src/modules/presets";
import { resolveModules, toSelection } from "../src/modules/resolver";
import type { StackContext } from "../src/modules/types";
import { EMBEDDED_TEMPLATES } from "../src/templates.generated";
import { GeneratorError } from "../src/types";

function withContribution(source: string, content = "export {};") {
  return new Map([...EMBEDDED_TEMPLATES, [source, content]]);
}

test("every embedded template has an explicit source owner and family", () => {
  const inventory = inventoryContributions(EMBEDDED_TEMPLATES);
  expect(inventory.issues).toEqual([]);
  expect(inventory.entries.map((entry) => entry.source).sort()).toEqual(
    [...EMBEDDED_TEMPLATES.keys()].sort(),
  );
  expect(() => assertContributionInventory(inventory)).not.toThrow();
});

test("unknown roots and module IDs fail rather than becoming generic contributions", () => {
  for (const [source, code] of [
    ["typo/files/package.json.hbs", "unknown-root"],
    ["modules/auht/files/apps/fullstack-web/src/index.ts", "unknown-module"],
    ["modules/auth/typo/apps/fullstack-web/src/index.ts", "unknown-contribution"],
  ]) {
    const inventory = inventoryContributions(withContribution(source!));
    expect(inventory.issues).toContainEqual(expect.objectContaining({ source, code }));
    expect(() => assertContributionInventory(inventory)).toThrow(GeneratorError);
  }
});

test("unknown application types are rejected in every nested module layer", () => {
  for (const prefix of [
    "modules/auth/files",
    "modules/auth/frameworks/next",
    "modules/payment/providers/mock/frameworks/next",
    "modules/auth/integrations/email/frameworks/next",
    "modules/auth/dialects/sqlite",
    "modules/auth/frameworks/next/providers/google/integrations/email/dialects/sqlite",
    "modules/auth/stack/better-auth",
  ]) {
    const source = `${prefix}/apps/web/src/typo.ts`;
    const inventory = inventoryContributions(withContribution(source));
    expect(inventory.issues).toContainEqual(
      expect.objectContaining({ code: "unknown-app-type", source }),
    );
    expect(() => assertContributionInventory(inventory)).toThrow("unknown-app-type");
  }
});

test("nested provider and integration IDs must be declared by their module", () => {
  for (const [source, code] of [
    ["modules/auth/providers/googel/apps/fullstack-web/src/index.ts", "unknown-provider"],
    [
      "modules/auth/frameworks/next/providers/googel/apps/fullstack-web/src/index.ts",
      "unknown-provider",
    ],
    ["modules/auth/integrations/emali/apps/fullstack-web/src/index.ts", "unknown-integration"],
    [
      "modules/auth/providers/google/integrations/storage/apps/fullstack-web/src/index.ts",
      "unknown-integration",
    ],
    ["modules/auth/dialects/mysql/apps/fullstack-web/src/index.ts", "unknown-dialect"],
    ["modules/auth/frameworks/nxt/apps/fullstack-web/src/index.ts", "unknown-framework"],
  ]) {
    expect(inventoryContributions(withContribution(source!)).issues).toContainEqual(
      expect.objectContaining({ source, code }),
    );
  }
});

test("a known application contribution is valid even when no selected app consumes it", () => {
  const source = "modules/core/files/apps/cli/src/command.ts";
  const inventory = inventoryContributions(withContribution(source));
  expect(inventory.issues).toEqual([]);
  expect(queryContributions(inventory, { module: "core", appType: "cli" })).toContainEqual(
    expect.objectContaining({ source, owner: "module:core", appType: "cli" }),
  );
});

test("legacy web branches remain explicit and desktop is not a stable application type", () => {
  const legacy = [
    "modules/auth/stack/better-auth/web/next/src/legacy.ts",
    "api/orpc/web/next/src/legacy.ts",
    "deploy/docker/web/next/legacy.Dockerfile",
  ];
  const inventory = inventoryContributions(
    new Map([
      ...EMBEDDED_TEMPLATES,
      ...legacy.map((source) => [source, "legacy content"] as const),
    ]),
  );
  expect(inventory.issues).toEqual([]);
  for (const source of legacy) {
    expect(inventory.entries).toContainEqual(
      expect.objectContaining({ source, legacy: true, variant: "legacy-web" }),
    );
  }
  const desktop = queryContributions(inventory, { owner: "addon:electrobun" });
  expect(desktop.length).toBeGreaterThan(0);
  expect(
    desktop.every((entry) => entry.legacy && entry.variant === "legacy-desktop" && !entry.appType),
  ).toBe(true);
  expect(
    queryContributions(inventory, { module: "auth", variant: "stack" }).every(
      (entry) => !entry.provider,
    ),
  ).toBe(true);
});

test("required selected implementations fail explicitly when their source is missing", () => {
  const sourcePrefix = "modules/payment/providers/stripe";
  const requirement = { source: "selection:payment:stripe", module: "payment", sourcePrefix };
  const inventory = inventoryContributions(EMBEDDED_TEMPLATES);
  expect(validateContributionRequirements(inventory, [requirement])).toEqual([]);
  const removed = new Map(
    [...EMBEDDED_TEMPLATES].filter(([source]) => !source.startsWith(`${sourcePrefix}/`)),
  );
  const missing = inventoryContributions(removed);
  expect(missing.issues).toEqual([]);
  expect(validateContributionRequirements(missing, [requirement])).toEqual([
    expect.objectContaining({ code: "missing-contribution", source: requirement.source }),
  ]);
  expect(() => assertContributionInventory(missing, [requirement])).toThrow("missing-contribution");

  const integrationPrefix = "modules/auth/integrations/email";
  const withoutIntegration = inventoryContributions(
    new Map(
      [...EMBEDDED_TEMPLATES].filter(([source]) => !source.startsWith(`${integrationPrefix}/`)),
    ),
  );
  expect(() =>
    assertContributionInventory(withoutIntegration, [
      {
        source: "selection:auth:email",
        sourcePrefix: integrationPrefix,
        integration: "email",
      },
    ]),
  ).toThrow("missing-contribution");
});

test("base-file providers and metadata are not mistaken for required provider directories", () => {
  const inventory = inventoryContributions(EMBEDDED_TEMPLATES);
  expect(queryContributions(inventory, { module: "auth", provider: "google" })).toEqual([]);
  expect(
    validateContributionRequirements(inventory, [
      {
        source: "selection:auth:google",
        module: "auth",
        sourcePrefix: "modules/auth/files/packages/auth",
      },
    ]),
  ).toEqual([]);
  expect(
    validateContributionRequirements(inventory, [
      {
        source: "selection:metadata-is-not-implementation",
        sourcePrefix: "apps/cli/app.json",
      },
    ]),
  ).toContainEqual(expect.objectContaining({ code: "missing-contribution" }));
  const empty = inventoryContributions(
    withContribution("modules/auth/providers/google/.gitkeep", ""),
  );
  expect(
    validateContributionRequirements(empty, [
      {
        source: "selection:empty-provider",
        sourcePrefix: "modules/auth/providers/google",
      },
    ]),
  ).toContainEqual(expect.objectContaining({ code: "missing-contribution" }));
});

test("selected native source contracts accept real full presets and reject removed selected layers", () => {
  for (const framework of ["next", "tanstack-start", "nuxt"] as const) {
    for (const database of ["sqlite", "postgres"] as const) {
      const config: StackContext = {
        projectName: "app",
        frontend: [framework],
        backend: "self",
        database,
        orm: "drizzle",
        api: "none",
        webDeploy: "none",
      };
      const plan = resolveModules(toSelection(PRODUCT_PRESETS.full), config, MODULE_CATALOG);
      expect(plan.issues.filter((issue) => issue.level === "error")).toEqual([]);
      const requirements = requiredModuleContributions(config, plan);
      expect(() => assertContributionInventory(EMBEDDED_TEMPLATES, requirements)).not.toThrow();
      for (const sourcePrefix of [
        "modules/payment/providers/stripe",
        "modules/auth/dialects/" + database,
        "modules/email/integrations/auth",
        "modules/auth/frameworks/" + framework,
      ]) {
        const removed = new Map(
          [...EMBEDDED_TEMPLATES].filter(([source]) => !source.startsWith(`${sourcePrefix}/`)),
        );
        expect(() => assertContributionInventory(removed, requirements)).toThrow(
          "missing-contribution",
        );
      }
      const authIntegration = requirements.filter((requirement) =>
        requirement.source.startsWith("module:auth:integration:email"),
      );
      expect(authIntegration.length).toBeGreaterThan(0);
      expect(
        authIntegration.some((requirement) =>
          requirement.sourcePrefix?.includes(
            framework === "nuxt" ? "frameworks/nuxt/" : "integrations/email/frameworks/",
          ),
        ),
      ).toBe(true);
      expect(requirements).toContainEqual(
        expect.objectContaining({
          source: "module:storage:provider:s3",
          sourcePrefix: "modules/storage/files/packages/storage/src/provider.ts.hbs",
        }),
      );
    }
  }
});
