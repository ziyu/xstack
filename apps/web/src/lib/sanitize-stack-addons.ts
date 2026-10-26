import type { Addons } from "@xstack/types";

import { BUILDER_DEFINITION, DEFAULT_STACK, type StackState, TECH_OPTIONS } from "./constant";
import { projectApplicationStack } from "./stack-applications";
import { StackModuleOptionsSchema, StackProvidersSchema } from "./stack-schema";

const validWebFrontendIds = TECH_OPTIONS.webFrontend.map((option) => option.id);
const validNativeFrontendIds = TECH_OPTIONS.nativeFrontend.map((option) => option.id);
const validAddonIds = ["none" as const, ...TECH_OPTIONS.addons.map((option) => option.id)];

function sanitizeSingleSelection<T extends string>(
  values: readonly string[] | null | undefined,
  validIds: readonly T[],
  defaultValue: readonly (T | "none")[],
): (T | "none")[] {
  if (values == null) {
    return [...defaultValue];
  }

  const selectedValue = values
    .flatMap((value) => validIds.filter((id) => id === value && id !== "none"))
    .at(-1);
  return selectedValue ? [selectedValue] : ["none"];
}

function sanitizeMultiSelection<T extends string>(
  values: readonly string[] | null | undefined,
  validIds: readonly T[],
  defaultValue: readonly (T | "none")[],
): (T | "none")[] {
  if (values == null) {
    return [...defaultValue];
  }

  const sanitized = values.flatMap((value) => validIds.filter((id) => id === value));
  const normalized =
    sanitized.length > 1 ? sanitized.filter((value) => value !== "none") : sanitized;
  const unique = [...new Set(normalized)];

  return unique.length > 0 ? unique : ["none"];
}

function resolveAddonConflicts(addons: readonly Addons[]): Addons[] {
  const resolved: Addons[] = [];
  const exclusiveGroups = BUILDER_DEFINITION.exclusiveAddonGroups.map(
    (group) => new Set<string>(group),
  );

  for (const addon of addons) {
    const group = exclusiveGroups.find((values) => values.has(addon));
    if (group) {
      const existingIndex = resolved.findIndex((value) => group.has(value));
      if (existingIndex !== -1) resolved.splice(existingIndex, 1);
    }

    if (!resolved.includes(addon)) {
      resolved.push(addon);
    }
  }

  return resolved;
}

export function sanitizeAddons(addons: readonly string[] | null | undefined) {
  const sanitized = sanitizeMultiSelection(addons, validAddonIds, DEFAULT_STACK.addons);
  return resolveAddonConflicts(sanitized);
}

export function sanitizeFeatures(features: readonly string[] | null | undefined) {
  const selected = [...new Set(features ?? DEFAULT_STACK.features)].filter((id) => id !== "none");
  return selected.length ? selected : ["none"];
}

export function sanitizeWebFrontends(webFrontend: readonly string[] | null | undefined) {
  return sanitizeSingleSelection(webFrontend, validWebFrontendIds, DEFAULT_STACK.webFrontend);
}

export function sanitizeNativeFrontends(nativeFrontend: readonly string[] | null | undefined) {
  return sanitizeSingleSelection(
    nativeFrontend,
    validNativeFrontendIds,
    DEFAULT_STACK.nativeFrontend,
  );
}

export type RawStackLists = Omit<
  StackState,
  "webFrontend" | "nativeFrontend" | "addons" | "features" | "apps"
> & {
  apps?: StackState["apps"] | null;
  webFrontend: string[];
  nativeFrontend: string[];
  addons: string[];
  features: string[];
};

export function sanitizeStackState(stack: RawStackLists): StackState {
  // Explicit layouts are validated, not repaired. In particular, never remove
  // incompatible features or addons while the user is editing an application.
  if (stack.apps != null) {
    return projectApplicationStack({ ...stack, apps: stack.apps } as StackState);
  }
  return {
    ...stack,
    apps: undefined,
    webFrontend: sanitizeWebFrontends(stack.webFrontend),
    nativeFrontend: sanitizeNativeFrontends(stack.nativeFrontend),
    addons: sanitizeAddons(stack.addons),
    features: sanitizeFeatures(stack.features),
    providers: StackProvidersSchema.safeParse(stack.providers).data ?? DEFAULT_STACK.providers,
    moduleOptions:
      StackModuleOptionsSchema.safeParse(stack.moduleOptions).data ?? DEFAULT_STACK.moduleOptions,
  };
}

export function sanitizeStackAddons(stack: StackState): StackState {
  return sanitizeStackState(stack);
}
