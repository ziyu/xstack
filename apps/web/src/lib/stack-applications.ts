import {
  APPLICATION_TEMPLATES,
  readApplicationCatalog,
  readFrameworkCatalog,
  resolveWorkspaceCapabilities,
  resolveApplications,
} from "@xstack/template-generator/apps";
import {
  FULLSTACK_FRONTENDS,
  webFrontends,
  type NativeFrontend,
  type ProjectConfig,
} from "@xstack/types";

import { getStackBackend, getStackFrontends } from "./stack-model";
import type { StackState, TechCategory } from "./types";

export const APPLICATION_TYPES = [...readApplicationCatalog(APPLICATION_TEMPLATES).values()];
export const APPLICATION_FRAMEWORKS = [...readFrameworkCatalog(APPLICATION_TEMPLATES).values()];
export const APPLICATION_TECH_CATEGORIES: TechCategory[] = [
  "webFrontend",
  "nativeFrontend",
  "backend",
  "runtime",
  "api",
];

/** Compatibility controls read a projection; application selections remain authoritative. */
export function projectApplicationStack(stack: StackState): StackState {
  if (stack.apps === undefined) return stack;
  const plan = resolveApplications(stack.apps, APPLICATION_TEMPLATES);
  const frontend =
    plan.apps.find((app) => app.manifest.roles.includes("web-frontend")) ??
    plan.apps.find((app) => app.manifest.roles.includes("admin"));
  const backend = plan.apps.find((app) => app.manifest.roles.includes("backend"));
  const independent = plan.apps.filter((app) => app.manifest.scope === "independent");
  const frontends = [
    ...(frontend?.adapter.stack.frontend ?? []),
    ...independent.flatMap((app) => app.adapter.stack.frontend ?? []),
  ];
  const web = frontends.filter((id): id is (typeof webFrontends)[number] =>
    webFrontends.some((candidate) => candidate === id),
  );
  const native = frontends.filter(
    (id): id is Exclude<NativeFrontend, "none"> =>
      id !== "none" && !webFrontends.some((candidate) => candidate === id),
  );
  const backendKind = backend?.adapter.stack.backend ?? "none";
  const selfFrontend = FULLSTACK_FRONTENDS.find((id) =>
    backend?.adapter.stack.frontend?.includes(id),
  );
  return {
    ...stack,
    webFrontend: web.length ? web : ["none"],
    nativeFrontend: native.length ? native : ["none"],
    backend:
      backendKind === "self" ? (selfFrontend ? `self-${selfFrontend}` : "none") : backendKind,
    runtime:
      backend?.adapter.stack.runtime ??
      independent.find((app) => app.adapter.stack.runtime !== undefined)?.adapter.stack.runtime ??
      "none",
    api: backend?.adapter.stack.api ?? "none",
  };
}

/** Collect errors without repairing or discarding any of the user's selections. */
export function applicationCapabilities(stack: StackState) {
  const config: ProjectConfig = {
    ...stack,
    projectName: "application-validation",
    projectDir: "/virtual",
    relativePath: "./virtual",
    frontend: getStackFrontends(stack),
    backend: getStackBackend(stack.backend),
    addons: stack.addons.filter((addon) => addon !== "none"),
    product: {
      features: stack.features.filter((feature) => feature !== "none"),
      providers: stack.providers,
      options: stack.moduleOptions,
    },
    git: stack.git === "true",
    install: false,
  };
  return resolveWorkspaceCapabilities(config);
}

export function applicationIssues(stack: StackState): string[] {
  return stack.apps === undefined ? [] : applicationCapabilities(stack).issues;
}
