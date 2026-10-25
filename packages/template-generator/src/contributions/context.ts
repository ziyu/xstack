import type { ProjectConfig } from "@xstack/types";

import type { ResolvedApplication } from "../apps/plan";
import type { StackContext } from "../modules/types";
import type { ApplicationRenderContext } from "../types";

export type ApplicationConfig = ProjectConfig &
  Pick<StackContext, "moduleApplication" | "productContributions" | "productRuntime"> & {
    application?: ApplicationRenderContext;
  };

/** Browser-safe projection shared by capability checks, preflight and rendering. */
export function resolveApplicationContext(
  config: ProjectConfig,
  app: ResolvedApplication,
): ApplicationConfig {
  const independent = app.manifest.scope === "independent";
  return {
    ...config,
    ...app.adapter.stack,
    apps: undefined,
    frontend: app.adapter.stack.frontend ?? ["none"],
    moduleApplication: {
      type: app.selection.type,
      framework: app.selection.stack.framework ?? "",
      roles: app.manifest.roles,
      contribution: independent ? undefined : app.adapter.productContribution,
    },
    backend: independent
      ? (app.adapter.stack.backend ?? "none")
      : (app.adapter.stack.backend ?? config.backend),
    runtime: independent
      ? (app.adapter.stack.runtime ?? "none")
      : (app.adapter.stack.runtime ?? config.runtime),
    api: independent
      ? (app.adapter.stack.api ?? "none")
      : app.manifest.roles.includes("backend")
        ? (app.adapter.stack.api ?? config.api)
        : config.api,
    database: independent ? "none" : config.database,
    orm: independent ? "none" : config.orm,
    product: independent ? { features: [] } : config.product,
  };
}

/** Physical output paths; backend ownership is distinct from the current client app. */
export function appOutputPath(
  config: ApplicationConfig,
  kind: "web" | "server" | "native",
  suffix = "",
): string {
  const application = config.application;
  let root: string | undefined;
  if (kind === "server") root = application?.backendRoot;
  root ??= application?.paths[`apps/${kind}`];
  if (!root && application) {
    const local =
      kind === "server"
        ? application.roles.includes("backend")
        : kind === "native"
          ? config.frontend.some((frontend) => frontend.startsWith("native-"))
          : config.frontend.some(
              (frontend) => frontend !== "none" && !frontend.startsWith("native-"),
            );
    if (local) root = `apps/${application.id}`;
  }
  root ??= kind === "server" && config.backend === "self" ? "apps/web" : `apps/${kind}`;
  return suffix ? `${root}/${suffix.replace(/^\/+/, "")}` : root;
}
