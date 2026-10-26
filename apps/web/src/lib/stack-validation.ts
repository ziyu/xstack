import {
  ProjectNameSchema,
  allowedApisForFrontends,
  getBackendDisabledOptions,
  getDesktopDeployConflict,
  hasCloudflareNextPostgresConflict,
  isFrontendAllowedWithBackend,
  supportsDatabaseSetup,
  supportsDatabaseSetupRuntime,
  supportsOrmDatabase,
  supportsRuntimeBackend,
  supportsRuntimeDatabase,
  supportsServerDeployRuntime,
  validateAddonCompatibility,
} from "@xstack/types";

import { TECH_OPTIONS, type StackState } from "./constant";
import { applicationIssues } from "./stack-applications";
import { featureIssue, productPlan, stackAuth } from "./stack-features";
import { getStackBackend, getStackFrontends, getSelfBackendFrontend } from "./stack-model";
import type { TechCategory } from "./types";

export interface CompatibilityResult {
  adjustedStack: StackState | null;
  notes: Record<string, { notes: string[]; hasIssue: boolean }>;
  changes: Array<{ category: string; message: string }>;
}

export function validateProjectName(name: string): string | undefined {
  const result = ProjectNameSchema.safeParse(name.split(/[\\/]/).filter(Boolean).at(-1) || "");
  return result.success ? undefined : result.error.issues[0]?.message;
}

export const getCategoryDisplayName = (key: string) => {
  const label = key.replace(/([A-Z])/g, " $1");
  return label.charAt(0).toUpperCase() + label.slice(1);
};

/** Validate through shared generator contracts. Never substitute a different user's stack. */
export function analyzeStackCompatibility(stack: StackState): CompatibilityResult {
  const notes: CompatibilityResult["notes"] = {};
  const add = (category: string, message: string) => {
    const entry = (notes[category] ??= { notes: [], hasIssue: true });
    if (!entry.notes.includes(message)) entry.notes.push(message);
  };
  if (stack.apps !== undefined) {
    for (const issue of applicationIssues(stack)) add("apps", issue);
    return { adjustedStack: null, notes, changes: [] };
  }
  const backend = getStackBackend(stack.backend);
  const frontend = getStackFrontends(stack);
  const auth = stackAuth(stack);
  for (const field of getBackendDisabledOptions(backend)) {
    if (stack[field] !== "none")
      add(field, `${stack.backend} does not use ${getCategoryDisplayName(field)}.`);
  }
  const requiredFrontend = getSelfBackendFrontend(stack.backend);
  if (requiredFrontend && !stack.webFrontend.includes(requiredFrontend)) {
    add("webFrontend", `${stack.backend} requires ${requiredFrontend}.`);
  }
  for (const id of frontend) {
    if (!isFrontendAllowedWithBackend(id, backend, auth))
      add(
        "webFrontend",
        `${id} is incompatible with ${backend} and the selected authentication engine.`,
      );
  }
  if (!supportsRuntimeBackend(stack.runtime, backend))
    add("runtime", `${stack.runtime} is incompatible with ${backend}.`);
  if (!supportsRuntimeDatabase(stack.runtime, stack.database))
    add("database", `${stack.database} is incompatible with ${stack.runtime}.`);
  if (!supportsOrmDatabase(stack.orm, stack.database))
    add("orm", `${stack.orm} does not support ${stack.database}.`);
  if (!supportsDatabaseSetup(stack.dbSetup, stack.database))
    add("dbSetup", `${stack.dbSetup} does not support ${stack.database}.`);
  if (!supportsDatabaseSetupRuntime(stack.dbSetup, stack.runtime, backend))
    add("dbSetup", `${stack.dbSetup} is incompatible with this application runtime.`);
  if (!allowedApisForFrontends(frontend).includes(stack.api))
    add("api", `${stack.api} has no implementation for ${frontend.join(", ")}.`);
  if (
    !supportsServerDeployRuntime(stack.serverDeploy, stack.runtime) &&
    !getBackendDisabledOptions(backend).some((field) => field === "serverDeploy")
  )
    add("serverDeploy", `${stack.serverDeploy} does not support ${stack.runtime}.`);
  if (stack.webDeploy !== "none" && !stack.webFrontend.some((id) => id !== "none"))
    add("webDeploy", "Web deployment requires a web frontend.");
  if (hasCloudflareNextPostgresConflict({ ...stack, frontend }))
    add("webDeploy", "The selected web deployment has no adapter for this database configuration.");
  const conflict = getDesktopDeployConflict(stack.webDeploy, stack.addons, frontend, backend, auth);
  if (conflict)
    add(
      "webDeploy",
      `${conflict.selectedDesktopAddons.join(", ")} require static output that cannot use the selected server deployment.`,
    );
  for (const addon of stack.addons) {
    const result = validateAddonCompatibility(addon, frontend, auth, backend, stack.runtime);
    if (!result.isCompatible) add("addons", result.reason ?? `Unsupported addon ${addon}`);
  }
  for (const issue of productPlan(stack).issues) {
    if (issue.level === "error") add("features", issue.message);
  }
  return { adjustedStack: null, notes, changes: [] };
}

/** Probe the same solver with the prospective value instead of maintaining UI-only rules. */
export function getDisabledReason(
  stack: StackState,
  category: TechCategory,
  optionId: string,
): string | null {
  if (category === "features" && optionId !== "none") return featureIssue(stack, optionId);
  if (!TECH_OPTIONS[category].some((option) => option.id === optionId))
    return `Unknown ${category} option ${optionId}`;
  const current = stack[category];
  const value = Array.isArray(current)
    ? category === "addons"
      ? [...current.filter((id) => id !== "none" && id !== optionId), optionId]
      : [optionId]
    : optionId;
  const candidate = { ...stack, [category]: value } as StackState;
  const previous = new Set(
    Object.values(analyzeStackCompatibility(stack).notes).flatMap((entry) => entry.notes),
  );
  return (
    Object.values(analyzeStackCompatibility(candidate).notes)
      .flatMap((entry) => entry.notes)
      .find((issue) => !previous.has(issue)) ?? null
  );
}

export function isOptionCompatible(stack: StackState, category: TechCategory, optionId: string) {
  return stack.yolo === "true" || getDisabledReason(stack, category, optionId) === null;
}
