import { readBuilderDefinition } from "@xstack/template-generator/builder";
import { MODULE_CATALOG, PRODUCT_PRESETS } from "@xstack/template-generator/modules";

import { createBuilderCatalog } from "./builder-catalog";
import type { StackState, TechCategory, StackOptionId } from "./types";
export type { StackState } from "./types";

export const ICON_BASE_URL = "/icons";
export const BUILDER_DEFINITION = readBuilderDefinition();
const catalog = createBuilderCatalog(BUILDER_DEFINITION, MODULE_CATALOG, PRODUCT_PRESETS);
export const TECH_OPTIONS = catalog.options;
export const DEFAULT_STACK = catalog.defaults;
export const PRESET_TEMPLATES = catalog.presets;

export function getStackOptionIds<K extends TechCategory>(category: K): StackOptionId<K>[] {
  return TECH_OPTIONS[category].map(({ id }) => id);
}

export function isStackOption<K extends TechCategory>(
  category: K,
  value: string,
): value is StackOptionId<K> {
  return TECH_OPTIONS[category].some(({ id }) => id === value);
}

export const isStackDefault = <K extends keyof StackState>(
  _stack: StackState,
  key: K,
  value: StackState[K],
): boolean => {
  const defaultValue = DEFAULT_STACK[key];
  if (Array.isArray(defaultValue) && Array.isArray(value)) {
    const sortedDefault = [...defaultValue].sort();
    const sortedValue = [...value].sort();
    return (
      sortedDefault.length === sortedValue.length &&
      sortedDefault.every((item, index) => item === sortedValue[index])
    );
  }
  if (key === "providers" || key === "moduleOptions" || key === "apps") {
    return JSON.stringify(defaultValue) === JSON.stringify(value);
  }
  return defaultValue === value;
};
