import { z } from "zod";

import { BUILDER_METADATA } from "../builder.generated";
import { GeneratorError } from "../types";

const option = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  icon: z.string(),
  color: z.string(),
  default: z.boolean().optional(),
  className: z.string().optional(),
  experimental: z.boolean().optional(),
});

const definition = z.strictObject({
  options: z.record(z.string(), z.array(option)),
  defaults: z.record(z.string(), z.unknown()),
  presets: z.array(
    z.strictObject({
      id: z.string().min(1),
      name: z.string().min(1),
      description: z.string(),
      group: z.string(),
      productPreset: z.string().optional(),
      stack: z.record(z.string(), z.unknown()),
    }),
  ),
  defaultPreset: z.string().min(1),
  exclusiveAddonGroups: z.array(z.array(z.string().min(1))),
  desktop: z.strictObject({
    addons: z.array(z.string().min(1)),
    frontends: z.array(z.string().min(1)),
  }),
});

/** Presentation and complete starting configurations belong to the template distribution. */
export function readBuilderDefinition(templates: ReadonlyMap<string, string> = BUILDER_METADATA) {
  try {
    const source = templates.get("builder.json");
    if (!source) throw new Error("Missing builder.json");
    const parsed = definition.parse(JSON.parse(source));
    const ids = new Set<string>();
    for (const preset of parsed.presets) {
      if (ids.has(preset.id)) throw new Error(`Duplicate builder preset ${preset.id}`);
      ids.add(preset.id);
    }
    if (!ids.has(parsed.defaultPreset))
      throw new Error(`Unknown default preset ${parsed.defaultPreset}`);
    for (const [category, options] of Object.entries(parsed.options)) {
      const optionIds = new Set<string>();
      for (const option of options) {
        if (optionIds.has(option.id)) throw new Error(`Duplicate ${category} option ${option.id}`);
        optionIds.add(option.id);
      }
    }
    return parsed;
  } catch (cause) {
    throw new GeneratorError({
      phase: "builder",
      message: `Invalid builder.json: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    });
  }
}

export type BuilderDefinition = z.infer<typeof definition>;
