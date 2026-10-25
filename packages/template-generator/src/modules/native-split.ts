import type { ProductContribution, StackContext } from "./types";

/** Only resolved adapter declarations participate; never look up global templates here. */
export function nativeSplitApplication(stack: StackContext): ProductContribution | undefined {
  return (
    stack.moduleApplication?.contribution ??
    stack.productContributions?.find((contribution) => contribution.mode === "server")
  );
}

/** Native module opt-in and every participating adapter must agree on the protocol and constraints. */
export function supportsNativeSplit(stack: StackContext, module?: string): boolean {
  const contributions = stack.productContributions;
  const local = nativeSplitApplication(stack);
  if (!local || !contributions?.length) return false;
  if (stack.moduleApplication && !stack.moduleApplication.contribution) return false;
  if (
    !contributions.some((contribution) => contribution.mode === "server") ||
    !contributions.some((contribution) => contribution.mode === "client")
  )
    return false;
  return contributions.every((contribution) => {
    const constraints = contribution.constraints;
    return (
      contribution.protocol === local.protocol &&
      (!module || contribution.modules.includes(module)) &&
      constraints.runtime.includes(stack.productRuntime ?? stack.runtime ?? "none") &&
      constraints.api.includes(stack.api) &&
      constraints.orm.includes(stack.orm) &&
      constraints.database.includes(stack.database) &&
      constraints.webDeploy.includes(stack.webDeploy)
    );
  });
}
