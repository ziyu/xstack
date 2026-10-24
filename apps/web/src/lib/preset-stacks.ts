import { PRESET_TEMPLATES, type StackState } from "./constant";
import { resolveStackCompatibility } from "./stack-compatibility";

function configurationKey(stack: StackState) {
  const {
    projectName: _,
    providers,
    moduleOptions,
    apps,
    ...configuration
  } = resolveStackCompatibility(stack).stack;
  const entries = [
    ...Object.entries(configuration)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, Array.isArray(value) ? [...value].sort() : value]),
    [
      "apps",
      apps
        ?.map((app) => ({
          id: app.id,
          type: app.type,
          product: app.product ?? "main",
          stack: Object.entries(app.stack).sort(([a], [b]) => a.localeCompare(b)),
          bindings: Object.entries(app.bindings ?? {}).sort(([a], [b]) => a.localeCompare(b)),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ],
    [
      "providers",
      Object.entries(providers)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, values]) => [key, [...values].sort()]),
    ],
    [
      "moduleOptions",
      Object.entries(moduleOptions)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, options]) => [
          key,
          Object.entries(options).sort(([a], [b]) => a.localeCompare(b)),
        ]),
    ],
  ];
  return JSON.stringify(entries);
}

const presetKeys = PRESET_TEMPLATES.map((preset) => ({
  preset,
  key: configurationKey(preset.stack),
}));

export function findMatchingPreset(stack: StackState) {
  const key = configurationKey(stack);
  return presetKeys.find((entry) => entry.key === key)?.preset;
}
