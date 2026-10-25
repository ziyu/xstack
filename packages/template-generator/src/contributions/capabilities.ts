import type { ProjectConfig } from "@xstack/types";

import { APPLICATION_TEMPLATES } from "../applications.generated";
import { resolveApplicationConfig } from "../apps/config";
import { resolveApplications } from "../apps/plan";
import { MODULE_CATALOG } from "../modules/catalog";
import { resolveModules, toSelection } from "../modules/resolver";
import type { ResolvedPlan } from "../modules/types";
import { resolveApplicationContext } from "./context";

export interface ModuleCapability {
  app: string;
  module: string;
  status: "native" | "stack" | "missing" | "not-applicable";
  reasons: string[];
}
export interface WorkspaceCapabilities {
  modules: ModuleCapability[];
  issues: string[];
  notes: string[];
}

/** One capability result for CLI, Builder and generation; stack auth is not native business parity. */
export function resolveWorkspaceCapabilities(
  input: ProjectConfig,
  templates = APPLICATION_TEMPLATES,
): WorkspaceCapabilities {
  const result: WorkspaceCapabilities = { modules: [], issues: [], notes: [] };
  let config: ProjectConfig;
  try {
    config = resolveApplicationConfig(input, templates);
  } catch (error) {
    result.issues.push(error instanceof Error ? error.message : String(error));
    return result;
  }
  const applications = input.apps ? resolveApplications(input.apps, templates).apps : [];
  const contexts = applications.length
    ? applications.map((app) => {
        const independent = app.manifest.scope === "independent";
        return {
          id: app.selection.id,
          type: app.selection.type,
          independent,
          config: resolveApplicationContext(config, app),
        };
      })
    : [{ id: "web", type: "fullstack-web", independent: false, config }];
  for (const context of contexts) {
    const plan: ResolvedPlan = resolveModules(
      toSelection(context.config.product),
      context.config,
      MODULE_CATALOG,
    );
    for (const issue of plan.issues.filter((issue) => issue.level === "error"))
      result.issues.push(`${context.id}: ${issue.message}`);
    for (const module of plan.modules) {
      const reasons = plan.issues
        .filter((issue) => issue.level === "error" && issue.module === module.manifest.id)
        .map((issue) => issue.message);
      if (module.variant === "native" && context.type !== "fullstack-web") {
        reasons.push(
          `Module ${module.manifest.id} has no ${context.type} application contribution`,
        );
        result.issues.push(`${context.id}: ${reasons.at(-1)}`);
      }
      result.modules.push({
        app: context.id,
        module: module.manifest.id,
        status: reasons.length ? "missing" : module.variant,
        reasons,
      });
      if (module.variant === "stack" && !reasons.length)
        result.notes.push(
          `${context.id}: ${module.manifest.id} uses stack authentication, not native product integrations or an administration console.`,
        );
    }
    if (context.independent)
      for (const module of input.product?.features ?? [])
        result.modules.push({
          app: context.id,
          module,
          status: "not-applicable",
          reasons: ["Independent applications do not consume product modules"],
        });
    // The current native shell wires database seams even if only its i18n foundation remains.
    const core = MODULE_CATALOG.get("core")?.supports;
    if (
      context.type === "fullstack-web" &&
      context.config.backend === "self" &&
      context.config.api === "none" &&
      context.config.frontend.some((f) => core?.frameworks?.includes(f))
    ) {
      if (core?.orms && !core.orms.includes(config.orm))
        result.issues.push(`${context.id}: product shell requires ORM ${core.orms.join(" or ")}`);
      if (core?.dialects && !core.dialects.some((d) => d === config.database))
        result.issues.push(
          `${context.id}: product shell requires database ${core.dialects.join(" or ")}`,
        );
    }
  }
  result.issues = [...new Set(result.issues)];
  result.notes = [...new Set(result.notes)];
  return result;
}
