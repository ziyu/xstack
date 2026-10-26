import type { BuilderDefinition } from "@xstack/template-generator/builder";
import type { ModuleManifest } from "@xstack/template-generator/modules";
import {
  ApplicationSelectionSchema,
  FrontendSchema,
  RuntimeSchema,
  APISchema,
  DatabaseSchema,
  ORMSchema,
  DatabaseSetupSchema,
  WebDeploySchema,
  ServerDeploySchema,
  PackageManagerSchema,
  AddonsSchema,
  type ProductConfig,
} from "@xstack/types";
import { z } from "zod";

import type { StackState, TechCategory, TechOptions } from "./types";

const schema = z.object({
  projectName: z.string().nullable(),
  apps: z.array(ApplicationSelectionSchema).optional(),
  webFrontend: z.array(FrontendSchema),
  nativeFrontend: z.array(FrontendSchema),
  backend: z.string().min(1),
  runtime: RuntimeSchema,
  api: APISchema,
  database: DatabaseSchema,
  orm: ORMSchema,
  dbSetup: DatabaseSetupSchema,
  webDeploy: WebDeploySchema,
  serverDeploy: ServerDeploySchema,
  packageManager: PackageManagerSchema,
  addons: z.array(AddonsSchema),
  features: z.array(z.string()),
  providers: z.record(z.string(), z.array(z.string())),
  moduleOptions: z.record(
    z.string(),
    z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  ),
  git: z.enum(["true", "false"]),
  install: z.enum(["true", "false"]),
  yolo: z.enum(["true", "false"]),
});

export interface BuilderPreset {
  id: string;
  name: string;
  description: string;
  group: string;
  stack: StackState;
}

/** Resolve presentation data once; no product names or framework combinations live in the UI. */
export function createBuilderCatalog(
  definition: BuilderDefinition,
  modules: ReadonlyMap<string, ModuleManifest>,
  products: Readonly<Record<string, ProductConfig>>,
) {
  const options = {
    ...definition.options,
    features: [...modules.values()]
      .filter((module) => !module.hidden)
      .map((module) => ({
        id: module.id,
        name: module.name.en,
        description: module.description.en,
        icon: "",
        color: "from-slate-500 to-slate-700",
      })),
  } as TechOptions;
  for (const category of schema
    .keyof()
    .options.filter(
      (key) => !["projectName", "apps", "providers", "moduleOptions", "yolo"].includes(key),
    )) {
    if (!Array.isArray(options[category as TechCategory])) {
      throw new Error(`builder.json is missing options for ${category}`);
    }
  }
  const parse = (stack: StackState): StackState => {
    for (const [category, choices] of Object.entries(options)) {
      const selected = stack[category as TechCategory];
      for (const id of Array.isArray(selected) ? selected : [selected]) {
        if (id !== "none" && !choices.some((choice) => choice.id === id)) {
          throw new Error(`builder.json selects unknown ${category} option ${id}`);
        }
      }
    }
    return stack;
  };
  const defaults = parse(schema.parse(definition.defaults) as StackState);
  const presets: BuilderPreset[] = definition.presets.map(({ productPreset, stack, ...preset }) => {
    const product = productPreset ? products[productPreset] : undefined;
    if (productPreset && !product) throw new Error(`Unknown product preset ${productPreset}`);
    const selected = { ...defaults };
    if (product) {
      selected.features = product.features;
      selected.providers = product.providers ?? {};
      selected.moduleOptions = { ...defaults.moduleOptions, ...product.options };
    }
    return { ...preset, stack: parse(schema.parse({ ...selected, ...stack }) as StackState) };
  });
  return {
    options,
    defaults: presets.find((preset) => preset.id === definition.defaultPreset)!.stack,
    presets,
  };
}
