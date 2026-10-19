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
    projectName: stack.projectName ?? "my-better-t-app",
    frontend: getStackFrontends(stack),
    backend: getStackBackend(stack.backend),
    database: stack.database,
    orm: stack.orm,
    api: stack.api,
    webDeploy: stack.webDeploy,
  };
}

function planFeatures(stack: StackState, features: string[]): ResolvedPlan {
  return resolveModules(toSelection({ features }), stackContext(stack), MODULE_CATALOG);
}

function errors(plan: ResolvedPlan) {
  return plan.issues.filter((issue) => issue.level === "error");
}

/** The auth engine the selected features hand to the stack templates. */
export function stackAuth(stack: StackState): Auth {
  const auth = planFeatures(stack, selectedFeatures(stack)).domains.auth;
  return auth === "better-auth" || auth === "clerk" ? auth : "none";
}

/** Why adding `feature` to the current selection fails on this stack, if it does. */
export function featureIssue(stack: StackState, feature: string): string | null {
  const current = selectedFeatures(stack);
  const known = new Set(errors(planFeatures(stack, current)).map((issue) => issue.message));
  const added = errors(planFeatures(stack, [...new Set([...current, feature])]));
  const issue =
    added.find((candidate) => candidate.module === feature) ??
    added.find((candidate) => !known.has(candidate.message));
  return issue?.message ?? null;
}

/** Drops selected features that cannot resolve on this stack, with the reason for each. */
export type FeatureRemoval = { feature: string; reason: string };

export type ResolvedFeatures = { features: string[]; removed: FeatureRemoval[] };

export function resolvableFeatures(stack: StackState): ResolvedFeatures {
  let features = selectedFeatures(stack);
  const removed: FeatureRemoval[] = [];
  for (;;) {
    const failing = errors(planFeatures(stack, features)).flatMap(({ module, message }) =>
      module && features.includes(module) ? [{ feature: module, reason: message }] : [],
    );
    if (!failing.length) return { features, removed };
    for (const entry of failing) {
      if (!removed.some(({ feature }) => feature === entry.feature)) removed.push(entry);
    }
    features = features.filter((id) => !removed.some((entry) => entry.feature === id));
  }
}
