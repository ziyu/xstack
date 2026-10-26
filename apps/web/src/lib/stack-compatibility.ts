import type { StackState } from "./constant";
import { sanitizeStackState } from "./sanitize-stack-addons";
import { analyzeStackCompatibility, type CompatibilityResult } from "./stack-validation";

type StackUpdate = Partial<StackState> | ((prev: StackState) => Partial<StackState>);
export type ResolvedStackCompatibility = CompatibilityResult & { stack: StackState };

export function resolveStackCompatibility(stack: StackState): ResolvedStackCompatibility {
  const normalized = sanitizeStackState(stack);
  return { ...analyzeStackCompatibility(normalized), stack: normalized };
}

export function applyStackUpdate(
  current: StackState,
  update: StackUpdate,
): ResolvedStackCompatibility {
  const stack = resolveStackCompatibility(current).stack;
  return resolveStackCompatibility({
    ...stack,
    ...(update instanceof Function ? update(stack) : update),
  });
}
