import { EMBEDDED_TEMPLATES, generate } from "@xstack/template-generator";

import { applicationIssues } from "@/lib/stack-applications";
import { resolveStackCompatibility } from "@/lib/stack-compatibility";
import { productPlan } from "@/lib/stack-features";
import { stackStateToConfig } from "@/lib/stack-schema";
import { formatProjectName } from "@/lib/stack-utils";
import { validateProjectName } from "@/lib/stack-validation";
import type { StackState } from "@/lib/types";

export interface PreparedStack {
  stack: StackState;
  /** Empty when the stack can be generated. */
  issues: string[];
}

/** Resolve compatibility adjustments once, then report every blocking issue in UI order. */
export function prepareStack(input: StackState): PreparedStack {
  const compatibility = resolveStackCompatibility(input);
  const stack = compatibility.stack;
  const compatibilityIssues = Object.values(compatibility.notes).flatMap((entry) =>
    entry.hasIssue ? entry.notes : [],
  );
  if (compatibilityIssues.length) return { stack, issues: compatibilityIssues };

  const nameError = validateProjectName(formatProjectName(stack.projectName));
  if (nameError) return { stack, issues: [nameError] };

  const appIssues = applicationIssues(stack);
  if (appIssues.length) return { stack, issues: appIssues };

  const planIssues = productPlan(stack)
    .issues.filter((issue) => issue.level === "error")
    .map((issue) => issue.message);
  return { stack, issues: planIssues };
}

/** Generate with the same template set the CLI embeds, so previews and exports match it. */
export function generateStackProject(stack: StackState) {
  return generate({ config: stackStateToConfig(stack), templates: EMBEDDED_TEMPLATES });
}
