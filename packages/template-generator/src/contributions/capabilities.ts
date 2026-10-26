import type { ProjectConfig } from "@xstack/types";

import { APPLICATION_TEMPLATES } from "../applications.generated";
import { resolveApplicationConfig } from "../apps/config";
import { resolveApplications } from "../apps/plan";
import { MODULE_METADATA } from "../modules.generated";
import { readModuleCatalog } from "../modules/metadata";
import { supportsNativeSplit } from "../modules/native-split";
import { resolveModules, toSelection } from "../modules/resolver";
import type { ModuleManifest, ResolvedPlan } from "../modules/types";
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

const CAPABILITY_TEMPLATES = new Map([...APPLICATION_TEMPLATES, ...MODULE_METADATA]);

/** One capability result for CLI, Builder and generation; stack auth is not native business parity. */
export function resolveWorkspaceCapabilities(
  input: ProjectConfig,
  templates = CAPABILITY_TEMPLATES,
): WorkspaceCapabilities {
  const result: WorkspaceCapabilities = { modules: [], issues: [], notes: [] };
  let config: ProjectConfig;
  let catalog: ReadonlyMap<string, ModuleManifest>;
  try {
    config = resolveApplicationConfig(input, templates);
    catalog = readModuleCatalog(templates);
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
          roles: app.manifest.roles,
          independent,
          config: resolveApplicationContext(config, app),
        };
      })
    : [
        {
          id: "web",
          type: "fullstack-web",
          roles: ["backend", "web-frontend"],
          independent: false,
          config,
        },
      ];
  for (const context of contexts) {
    const plan: ResolvedPlan = resolveModules(
      toSelection(context.config.product),
      context.config,
      catalog,
    );
    for (const issue of plan.issues.filter((issue) => issue.level === "error"))
      result.issues.push(`${context.id}: ${issue.message}`);
    for (const module of plan.modules) {
      const reasons = plan.issues
        .filter((issue) => issue.level === "error" && issue.module === module.manifest.id)
        .map((issue) => issue.message);
      if (
        module.variant === "native" &&
        !(
          context.roles.includes("backend") &&
          context.roles.some((role) => role === "web-frontend" || role === "admin")
        ) &&
        !(module.manifest.nativeSplit && supportsNativeSplit(context.config, module.manifest.id))
      ) {
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
  }
  result.issues = [...new Set(result.issues)];
  result.notes = [...new Set(result.notes)];
  return result;
}
