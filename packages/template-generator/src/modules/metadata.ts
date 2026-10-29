import {
  ProductConfigSchema,
  ProductPresetSchema,
  type ProductConfig,
  type ProductPreset,
} from "@xstack/types";
import { z } from "zod";

import { GeneratorError } from "../types";
import { dependencyVersionMap } from "../utils/add-deps";
import type { ModuleManifest } from "./types";

const identifier = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Expected a lowercase kebab-case identifier");
const strings = z.array(z.string().min(1));
const localized = z.strictObject({ en: z.string().min(1), "zh-CN": z.string().min(1) });
const scalar = z.union([z.string(), z.number().finite(), z.boolean()]);
const dependencies = z.record(z.string().min(1), z.string().min(1));
const support = z.strictObject({
  frameworks: strings.optional(),
  backends: strings.optional(),
  orms: strings.optional(),
  apis: strings.optional(),
  dialects: z.array(z.enum(["sqlite", "postgres"])).optional(),
  targets: z.array(z.enum(["vercel", "docker", "cloudflare", "node", "none"])).optional(),
});
const environment = z.array(
  z.strictObject({
    key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    required: z.boolean().optional(),
    public: z.boolean().optional(),
    sensitive: z.boolean().optional(),
    type: z.enum(["string", "url", "number", "boolean", "secret", "enum"]).optional(),
    values: strings.optional(),
    example: z.string().optional(),
    originRole: identifier.optional(),
    default: z.string().optional(),
    comment: z.string().optional(),
  }),
);
const option = z
  .discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("enum"),
      values: strings.min(1),
      default: z.string(),
      description: z.string().optional(),
    }),
    z.strictObject({
      type: z.literal("boolean"),
      default: z.boolean(),
      description: z.string().optional(),
    }),
    z.strictObject({
      type: z.literal("number"),
      default: z.number().finite(),
      min: z.number().finite().optional(),
      max: z.number().finite().optional(),
      integer: z.boolean().optional(),
      description: z.string().optional(),
    }),
    z.strictObject({
      type: z.literal("string"),
      default: z.string(),
      description: z.string().optional(),
    }),
  ])
  .superRefine((value, context) => {
    if (value.type === "enum" && !value.values.includes(value.default))
      context.addIssue({ code: "custom", message: "Default must be one of the declared values" });
    if (
      value.type === "number" &&
      ((value.min !== undefined && value.default < value.min) ||
        (value.max !== undefined && value.default > value.max) ||
        (value.integer && !Number.isSafeInteger(value.default)))
    )
      context.addIssue({
        code: "custom",
        message: "Default must satisfy the declared numeric constraints",
      });
  });
const provider = z.strictObject({
  name: z.string().min(1),
  market: z.enum(["global", "cn", "any"]),
  help: z.string().optional(),
  env: environment.optional(),
  dependencies: dependencies.optional(),
  devDependencies: dependencies.optional(),
  appDependencies: dependencies.optional(),
  serverExternalPackages: strings.optional(),
  supports: support.optional(),
});
const manifestSchema = z
  .strictObject({
    id: identifier,
    name: localized,
    description: localized,
    category: z.enum([
      "foundation",
      "identity",
      "monetization",
      "communication",
      "content",
      "ai",
      "operations",
    ]),
    notices: strings.optional(),
    hidden: z.boolean().optional(),
    requires: strings.optional(),
    enhances: strings.optional(),
    conflicts: strings.optional(),
    supports: support.optional(),
    nativeSplit: z.literal(true).optional(),
    requiredWhen: support.optional(),
    sources: z
      .strictObject({
        required: strings.optional(),
        serverRequired: strings.optional(),
        frameworkRequired: z.record(z.string(), strings).optional(),
        dialects: z.literal(true).optional(),
        frameworks: strings.optional(),
        providers: z
          .discriminatedUnion("mode", [
            z.strictObject({ mode: z.literal("inline"), source: z.string().min(1) }),
            z.strictObject({
              mode: z.literal("separate"),
              frameworks: z.record(z.string(), z.record(z.string(), z.string())).optional(),
            }),
          ])
          .optional(),
        integrations: z
          .record(
            z.string(),
            z.strictObject({
              serverOnly: z.boolean().optional(),
              base: z.string().optional(),
              frameworks: z.record(z.string(), z.string()).optional(),
              required: strings.optional(),
            }),
          )
          .optional(),
      })
      .optional(),
    domain: z
      .strictObject({
        field: z.literal("auth"),
        value: z.union([
          z.strictObject({ literal: z.string() }),
          z.strictObject({ option: z.string().min(1) }),
        ]),
        native: z
          .union([
            z.strictObject({ option: z.string().min(1), equals: scalar }),
            z.strictObject({ provider: z.string().min(1) }),
          ])
          .optional(),
        stack: z
          .strictObject({
            supports: support.optional(),
            providers: strings.optional(),
            requires: strings.optional(),
            renderer: z.literal("auth"),
          })
          .optional(),
      })
      .optional(),
    providers: z
      .strictObject({
        help: z.string().optional(),
        min: z.number().int().nonnegative().optional(),
        max: z.number().int().nonnegative().optional(),
        default: z.strictObject({ global: strings, cn: strings }).optional(),
        targetDefaults: z
          .partialRecord(z.enum(["vercel", "docker", "cloudflare", "node", "none"]), strings)
          .optional(),
        options: z.record(identifier, provider),
      })
      .optional(),
    options: z.record(z.string().min(1), option).optional(),
    packages: z
      .array(
        z.strictObject({
          dir: identifier,
          dependencies: dependencies.optional(),
          devDependencies: dependencies.optional(),
          workspaceDependencies: strings.optional(),
        }),
      )
      .optional(),
    appDependencies: dependencies.optional(),
    frameworkAppDependencies: z.record(z.string(), dependencies).optional(),
    env: environment.optional(),
    services: z
      .array(
        z.strictObject({
          name: z.string().min(1),
          imports: z.array(z.strictObject({ from: z.string().min(1), names: strings })),
          init: z.string(),
        }),
      )
      .optional(),
    nav: z
      .array(
        z.strictObject({
          area: z.enum(["main", "dashboard", "admin", "footer"]),
          href: z.string(),
          labelKey: z.string(),
          order: z.number().optional(),
          auth: z.boolean().optional(),
          role: z.string().optional(),
          when: z.string().optional(),
        }),
      )
      .optional(),
    proxy: z
      .array(
        z.strictObject({ id: z.string(), from: z.string(), name: z.string(), order: z.number() }),
      )
      .optional(),
    replaces: strings.optional(),
    frameworkReplaces: z.record(z.string(), strings).optional(),
  })
  .superRefine((manifest, context) => {
    const options = manifest.options ?? {};
    const value = manifest.domain?.value;
    const native = manifest.domain?.native;
    for (const name of [
      value && "option" in value ? value.option : undefined,
      native && "option" in native ? native.option : undefined,
    ]) {
      if (name !== undefined && !Object.hasOwn(options, name))
        context.addIssue({ code: "custom", message: `Domain references unknown option "${name}"` });
    }
    const providers = manifest.providers;
    if (native && "provider" in native && !Object.hasOwn(providers?.options ?? {}, native.provider))
      context.addIssue({
        code: "custom",
        message: `Domain references unknown provider "${native.provider}"`,
      });
    if (!providers) return;
    if (providers.max !== undefined && (providers.min ?? 0) > providers.max)
      context.addIssue({ code: "custom", message: "Provider minimum exceeds maximum" });
    const defaults = [
      ...Object.values(providers.default ?? {}),
      ...Object.values(providers.targetDefaults ?? {}),
    ];
    for (const selection of defaults) {
      if (selection.some((id) => !Object.hasOwn(providers.options, id)))
        context.addIssue({
          code: "custom",
          message: "Provider defaults reference an unknown provider",
        });
      if (
        selection.length < (providers.min ?? 0) ||
        (providers.max !== undefined && selection.length > providers.max)
      )
        context.addIssue({
          code: "custom",
          message: "Provider defaults violate the provider count constraints",
        });
    }
  });

function parseJson(content: string, path: string): unknown {
  try {
    return JSON.parse(content);
  } catch (cause) {
    throw new GeneratorError({
      phase: "modules",
      message: `Invalid module metadata JSON at ${path}`,
      cause,
    });
  }
}

function resolveDependencies(values: Record<string, string> | undefined, path: string): void {
  for (const [name, value] of Object.entries(values ?? {})) {
    if (!value.startsWith("$dependency:")) continue;
    const reference = value.slice("$dependency:".length);
    if (!Object.hasOwn(dependencyVersionMap, reference))
      throw new GeneratorError({
        phase: "modules",
        message: `Unknown dependency version reference "${reference}" at ${path}`,
      });
    values![name] = dependencyVersionMap[reference as keyof typeof dependencyVersionMap];
  }
}

/** Discover only declarations from the supplied map; never merge a hidden global catalog. */
export function readModuleCatalog(
  templates: ReadonlyMap<string, string>,
): Map<string, ModuleManifest> {
  const catalog = new Map<string, ModuleManifest>();
  for (const [path, content] of templates) {
    const match = /^modules\/([^/]+)\/module\.json$/.exec(path);
    if (!match) continue;
    const parsed = manifestSchema.safeParse(parseJson(content, path));
    if (!parsed.success)
      throw new GeneratorError({
        phase: "modules",
        message: `Invalid module manifest at ${path}: ${parsed.error.message}`,
        cause: parsed.error,
      });
    const manifest = parsed.data as ModuleManifest;
    if (manifest.id !== match[1])
      throw new GeneratorError({
        phase: "modules",
        message: `Module manifest ID "${manifest.id}" must match its directory at ${path}`,
      });
    resolveDependencies(manifest.appDependencies, path);
    for (const values of Object.values(manifest.frameworkAppDependencies ?? {}))
      resolveDependencies(values, path);
    for (const spec of [
      ...(manifest.packages ?? []),
      ...Object.values(manifest.providers?.options ?? {}),
    ]) {
      resolveDependencies(spec.dependencies, path);
      resolveDependencies(spec.devDependencies, path);
      if ("appDependencies" in spec) resolveDependencies(spec.appDependencies, path);
    }
    catalog.set(manifest.id, manifest);
  }
  return catalog;
}

export function readProductPresets(
  templates: ReadonlyMap<string, string>,
): Record<ProductPreset, ProductConfig> {
  const path = "modules/presets.json";
  const content = templates.get(path);
  if (content === undefined)
    throw new GeneratorError({ phase: "modules", message: `Missing product presets at ${path}` });
  const parsed = z
    .record(ProductPresetSchema, ProductConfigSchema)
    .safeParse(parseJson(content, path));
  if (!parsed.success)
    throw new GeneratorError({
      phase: "modules",
      message: `Invalid product presets at ${path}: ${parsed.error.message}`,
      cause: parsed.error,
    });
  return parsed.data;
}
