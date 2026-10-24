import type { ProjectConfig } from "@xstack/types";

import { resolveApplicationConfig } from "../apps/config";
import { resolveApplications } from "../apps/plan";
import { toRenderConfig, getModulePlan } from "../modules/pipeline";
import { planAuthContributions } from "../modules/stack/auth";
import { planApiContributions } from "../template-handlers/api";
import { GeneratorError, type RenderConfig } from "../types";
import { assertContributionInventory } from "./inventory";
import { requiredModuleContributions } from "./requirements";
import type { StackContribution } from "./stack";

export interface PlannedStackContribution extends StackContribution {
  app?: string;
  output: string;
}
/** Validate all selected stack contributions before any application's VFS is created. */
export function planStackContributions(
  input: ProjectConfig,
  templates: Map<string, string>,
): PlannedStackContribution[] {
  const config = resolveApplicationConfig(input, templates);
  const apps = config.apps ? resolveApplications(config.apps, templates).apps : [];
  const contexts: { app?: string; config: RenderConfig; root?: string }[] = [];
  if (!apps.length) contexts.push({ config: toRenderConfig(config) });
  for (const app of apps) {
    const independent = app.manifest.scope === "independent";
    const local = toRenderConfig({
      ...config,
      ...app.adapter.stack,
      apps: undefined,
      frontend: app.adapter.stack.frontend ?? [],
      api: independent
        ? (app.adapter.stack.api ?? "none")
        : app.manifest.roles.includes("backend")
          ? (app.adapter.stack.api ?? config.api)
          : config.api,
      backend: independent ? "none" : (app.adapter.stack.backend ?? config.backend),
      product: independent ? { features: [] } : config.product,
    });
    local.application = {
      id: app.selection.id,
      type: app.selection.type,
      port: 3000,
      clientOrigins: [],
      paths: {},
      workspaceRuntime: config.runtime,
      ownsPath: () => true,
    };
    contexts.push({ app: app.selection.id, config: local, root: `apps/${app.selection.id}` });
  }
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
