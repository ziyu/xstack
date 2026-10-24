import type { ProjectConfig } from "@xstack/types";

import { APPLICATION_TEMPLATES } from "../applications.generated";
import { GeneratorError } from "../types";
import { resolveApplications, type ApplicationPlan } from "./plan";

export function requireApplicationPlan(
  config: ProjectConfig,
  templates: Map<string, string>,
): ApplicationPlan {
  const plan = resolveApplications(config.apps ?? [], templates);
  if (plan.issues.length) {
    throw new GeneratorError({
      phase: "applications",
      message: plan.issues.map((issue) => issue.message).join("; "),
    });
  }
  return plan;
}

/** Application adapters, rather than legacy frontend flags, own the effective stack. */
export function resolveApplicationConfig(
  config: ProjectConfig,
  templates = APPLICATION_TEMPLATES,
): ProjectConfig {
  if (!config.apps) return config;
  const plan = requireApplicationPlan(config, templates);
  if (!plan.apps.length)
    throw new GeneratorError({ phase: "applications", message: "Select at least one application" });
  const products = new Set(plan.apps.flatMap((app) => (app.product ? [app.product] : [])));
  if (products.size > 1) {
    throw new GeneratorError({
      phase: "applications",
      message:
        "Generating multiple products requires product-scoped database and module configuration; select one product plus independent applications.",
    });
  }
  const frontend =
    plan.apps.find((app) => app.manifest.roles.includes("web-frontend")) ??
    plan.apps.find((app) => app.manifest.roles.includes("admin"));
  const backend = plan.apps.find((app) => app.manifest.roles.includes("backend"));
  const frontendStack = frontend?.adapter.stack;
  const backendStack = backend?.adapter.stack;
  const independentFrontend = plan.apps.flatMap((app) =>
    app.manifest.scope === "independent" ? (app.adapter.stack.frontend ?? []) : [],
  );
  const frontends = [...(frontendStack?.frontend ?? []), ...independentFrontend];
  const independentRuntime = plan.apps.find(
    (app) => app.manifest.scope === "independent" && app.adapter.stack.runtime !== undefined,
  )?.adapter.stack.runtime;
  const resolved: ProjectConfig = {
    ...config,
    frontend: frontends.length ? frontends : ["none"],
    backend: backendStack?.backend ?? "none",
    runtime: backendStack?.runtime ?? independentRuntime ?? "none",
    api: backendStack?.api ?? "none",
    product: config.product ?? { features: [] },
  };
  if (!backend) {
    resolved.database = "none";
    resolved.orm = "none";
    resolved.dbSetup = "none";
  }
  // These processors/provisioners still address canonical app paths. Refuse rather
  // than generating deployment commands pointing at another app or leaking secrets.
  if (config.webDeploy !== "none" || config.serverDeploy !== "none" || config.dbSetup !== "none") {
    throw new GeneratorError({
      phase: "applications",
      message:
        "Explicit application layouts currently require webDeploy/serverDeploy/dbSetup=none; app-scoped provisioning must be configured before using deployment adapters.",
    });
  }
  const unsupported = config.addons.filter((addon) => !["turborepo", "none"].includes(addon));
  if (unsupported.length) {
    throw new GeneratorError({
      phase: "applications",
      message: `These addons do not yet declare application targets: ${unsupported.join(", ")}`,
    });
  }
  return resolved;
}
