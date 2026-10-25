import type { ProjectConfig } from "@xstack/types";

import { toRenderConfig, getModulePlan } from "../modules/pipeline";
import { planAuthContributions } from "../modules/stack/auth";
import { planApiContributions } from "../template-handlers/api";
import { GeneratorError, type RenderConfig } from "../types";
import { assertContributionInventory } from "./inventory";
import { requiredModuleContributions } from "./requirements";
import type { StackContribution } from "./stack";
import { buildWorkspacePlan } from "./workspace";

export interface PlannedStackContribution extends StackContribution {
  app?: string;
  output: string;
}
/** Validate all selected stack contributions before any application's VFS is created. */
export function planStackContributions(
  input: ProjectConfig,
  templates: Map<string, string>,
): PlannedStackContribution[] {
  const workspace = input.apps ? buildWorkspacePlan(input, templates) : undefined;
  const contexts: { app?: string; config: RenderConfig; root?: string }[] = workspace
    ? workspace.applications.map((entry) => ({
        app: entry.app.selection.id,
        config: { ...toRenderConfig(entry.config), application: entry.context },
        root: entry.context.directory,
      }))
    : [{ config: toRenderConfig(input) }];
  const contributions: PlannedStackContribution[] = [];
  for (const context of contexts) {
    assertContributionInventory(
      templates,
      requiredModuleContributions(context.config, getModulePlan(context.config)),
    );
    const auth = getModulePlan(context.config).modules.some(
      (module) => module.variant === "stack" && module.manifest.domain?.stack?.renderer === "auth",
    )
      ? planAuthContributions(context.config)
      : [];
    for (const item of [...planApiContributions(context.config), ...auth]) {
      const suffix = item.target.split("/").slice(2).join("/");
      const output =
        context.root && item.target.startsWith("apps/")
          ? `${context.root}${suffix ? `/${suffix}` : ""}`
          : item.target;
      const present =
        item.kind === "file"
          ? templates.has(item.source)
          : [...templates.keys()].some((path) => path.startsWith(`${item.source}/`));
      if (item.required && !present)
        throw new GeneratorError({
          phase: "contributions",
          message: `Missing required contribution ${item.source} for ${context.app ?? "workspace"}`,
        });
      contributions.push({ ...item, app: context.app, output });
    }
  }
  return contributions;
}
