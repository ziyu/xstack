import {
  MODULE_CATALOG,
  resolveModules,
  toSelection,
  type ResolvedPlan,
  type StackContext,
} from "@xstack/template-generator/modules";
import type { Auth } from "@xstack/types";

import { getStackBackend, getStackFrontends } from "./stack-model";
import type { StackState } from "./types";

export function selectedFeatures(stack: Pick<StackState, "features">): string[] {
  return stack.features.filter((id) => id !== "none");
}

function stackContext(stack: StackState): StackContext {
  return {
    projectName: stack.projectName ?? "my-xstack-app",
    frontend: getStackFrontends(stack),
    backend: getStackBackend(stack.backend),
    database: stack.database,
    orm: stack.orm,
    api: stack.api,
    webDeploy: stack.webDeploy,
    dbSetup: stack.dbSetup,
  };
}

/** The generator's complete plan, including provider and option validation. */
export function productPlan(stack: StackState): ResolvedPlan {
  return resolveModules(
    toSelection({
      features: selectedFeatures(stack),
      providers: stack.providers,
      options: stack.moduleOptions,
    }),
    stackContext(stack),
    MODULE_CATALOG,
  );
}

/** The auth engine the selected features hand to the stack templates. */
export function stackAuth(stack: StackState): Auth {
  const auth = productPlan(stack).domains.auth;
  return auth === "better-auth" || auth === "clerk" ? auth : "none";
}

/** Why adding `feature` to the current selection fails on this stack, if it does. */
export function featureIssue(stack: StackState, feature: string): string | null {
  const current = selectedFeatures(stack);
  if (current.includes(feature)) return null;
  // Provider/option errors are repaired in their controls, not by disabling a feature.
  const structuralStack = { ...stack, providers: {}, moduleOptions: {} };
  const known = new Set(
    productPlan(structuralStack)
      .issues.filter((issue) => issue.level === "error")
      .map((issue) => issue.message),
  );
  const added = productPlan({ ...structuralStack, features: [...current, feature] }).issues.filter(
    (issue) => issue.level === "error",
  );
  const issue =
    added.find((candidate) => candidate.module === feature) ??
    added.find((candidate) => !known.has(candidate.message));
  return issue?.message ?? null;
}

/** Drops structurally incompatible features, never features with invalid provider/option input. */
export type FeatureRemoval = { feature: string; reason: string };

export type ResolvedFeatures = { features: string[]; removed: FeatureRemoval[] };

export function resolvableFeatures(stack: StackState): ResolvedFeatures {
  let features = selectedFeatures(stack);
  const removed: FeatureRemoval[] = [];
  while (features.length) {
    const current = productPlan({ ...stack, features });
    const defaults = resolveModules(toSelection({ features }), stackContext(stack), MODULE_CATALOG);
    const structuralErrors = new Set(
      defaults.issues.filter((issue) => issue.level === "error").map((issue) => issue.message),
    );
    const failing = current.issues.flatMap(({ level, module, message }) =>
      level === "error" && module && features.includes(module) && structuralErrors.has(message)
        ? [{ feature: module, reason: message }]
        : [],
    );
    if (!failing.length) break;
    for (const entry of failing) {
      if (!removed.some(({ feature }) => feature === entry.feature)) removed.push(entry);
    }
    features = features.filter((id) => !removed.some((entry) => entry.feature === id));
  }
  return { features, removed };
}
