import type { ProjectConfig } from "@xstack/types";

import type { ResolvedApplication } from "../apps/plan";
import type { ApplicationRenderContext } from "../types";

export type ApplicationConfig = ProjectConfig & { application?: ApplicationRenderContext };

/** Browser-safe projection shared by capability checks, preflight and rendering. */
export function resolveApplicationContext(
  config: ProjectConfig,
  app: ResolvedApplication,
): ProjectConfig {
  const independent = app.manifest.scope === "independent";
  return {
    ...config,
    ...app.adapter.stack,
    apps: undefined,
    frontend: app.adapter.stack.frontend ?? ["none"],
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
        ? application.type === "backend" || application.type === "fullstack-web"
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
