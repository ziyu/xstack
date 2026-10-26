import path from "node:path";

import { EMBEDDED_TEMPLATES, resolveApplications } from "@xstack/template-generator";
import {
  ApplicationIdSchema,
  ApplicationSelectionStackSchema,
  type ApplicationSelection,
  type ApplicationStack,
} from "@xstack/types";
import { Result } from "better-result";
import fs from "fs-extra";
import { z } from "zod";

import type { ProjectConfig } from "../types";
import { CLIError, DatabaseSetupError } from "../utils/errors";

export interface WorkspaceApplication {
  id: string;
  type: string;
  roles: string[];
  directory: string;
  stack: ApplicationStack & ApplicationSelection["stack"];
  bindings: Record<string, string>;
  scope: "product" | "independent";
  port?: number;
  origin?: string;
}

const inventorySchema = z.array(
  z.object({
    id: ApplicationIdSchema,
    type: ApplicationIdSchema,
    roles: z.array(z.string().min(1)),
    directory: z.string().min(1),
    stack: ApplicationSelectionStackSchema,
    bindings: z.record(z.string(), ApplicationIdSchema),
    product: ApplicationIdSchema.nullable().optional(),
    port: z.number().int().positive().optional(),
    origin: z.string().optional(),
  }),
);

/** Resolve generated ownership, or the same catalog before files have been written. */
export async function resolveWorkspaceApplications(
  config: ProjectConfig,
): Promise<Result<WorkspaceApplication[], CLIError>> {
  return Result.tryPromise({
    try: async () => {
      const inventoryPath = path.join(config.projectDir, "applications.json");
      const inventory = (await fs.pathExists(inventoryPath))
        ? inventorySchema.parse(await fs.readJson(inventoryPath))
        : undefined;
      if (config.apps !== undefined || inventory) {
        const selections =
          config.apps ??
          inventory!.map(({ id, type, stack, bindings, product }) => ({
            id,
            type,
            stack,
            bindings,
            product: product ?? undefined,
          }));
        const plan = resolveApplications(selections, EMBEDDED_TEMPLATES);
        if (plan.issues.length) {
          throw new Error(plan.issues.map((issue) => issue.message).join("; "));
        }
        if (
          inventory &&
          (inventory.length !== plan.apps.length ||
            new Set(inventory.map((app) => app.id)).size !== inventory.length)
        ) {
          throw new Error("Generated application inventory does not match configured applications");
        }
        return plan.apps.map((app): WorkspaceApplication => {
          const generated = inventory?.find((entry) => entry.id === app.selection.id);
          if (
            inventory &&
            (!generated ||
              generated.type !== app.selection.type ||
              generated.directory !== `apps/${app.selection.id}` ||
              generated.roles.length !== app.manifest.roles.length ||
              generated.roles.some((role) => !app.manifest.roles.includes(role)))
          ) {
            throw new Error(`Invalid generated ownership for application ${app.selection.id}`);
          }
          return {
            id: app.selection.id,
            type: app.selection.type,
            roles: generated?.roles ?? app.manifest.roles,
            directory: generated?.directory ?? `apps/${app.selection.id}`,
            stack: { ...app.adapter.stack, ...app.selection.stack },
            bindings: generated?.bindings ?? app.bindings,
            scope: app.manifest.scope,
            port: generated?.port,
            origin: generated?.origin,
          };
        });
      }

      // Legacy projects have no application selections or generated ownership inventory.
      const apps: WorkspaceApplication[] = [];
      const web = config.frontend.filter(
        (frontend) => frontend !== "none" && !frontend.startsWith("native-"),
      );
      const native = config.frontend.filter((frontend) => frontend.startsWith("native-"));
      const webPort = web.includes("astro")
        ? 4321
        : web.some((frontend) => frontend === "svelte" || frontend === "react-router")
          ? 5173
          : 3001;
      if (web.length || config.backend === "self") {
        apps.push({
          id: "web",
          type: "legacy",
          directory: "apps/web",
          scope: "product",
          roles: config.backend === "self" ? ["web-frontend", "backend"] : ["web-frontend"],
          stack: {
            frontend: web,
            backend: config.backend === "self" ? "self" : "none",
            runtime: config.runtime,
            api: config.api,
          },
          bindings:
            config.backend !== "none" && config.backend !== "self" ? { backend: "server" } : {},
          port: webPort,
          origin: `http://localhost:${webPort}`,
        });
      }
      if (config.backend !== "none" && config.backend !== "self") {
        apps.push({
          id: "server",
          type: "legacy",
          directory: config.backend === "convex" ? "packages/backend" : "apps/server",
          scope: "product",
          roles: ["backend"],
          stack: { backend: config.backend, runtime: config.runtime, api: config.api },
          bindings: {},
          port: config.backend === "convex" ? undefined : 3000,
          origin: config.backend === "convex" ? undefined : "http://localhost:3000",
        });
      }
      if (native.length) {
        apps.push({
          id: "native",
          type: "legacy",
          directory: "apps/native",
          scope: "independent",
          roles: [],
          stack: { frontend: native },
          bindings:
            config.backend === "none"
              ? {}
              : { backend: config.backend === "self" ? "web" : "server" },
          port: 8081,
          origin: "http://localhost:8081",
        });
      }
      if (config.addons.includes("starlight")) {
        apps.push({
          id: "docs",
          type: "legacy",
          directory: "apps/docs",
          roles: ["docs"],
          scope: "independent",
          stack: {},
          bindings: {},
          port: 4321,
          origin: "http://localhost:4321",
        });
      }
      if (config.addons.includes("fumadocs")) {
        const port = config.addonOptions?.fumadocs?.devPort ?? 4000;
        apps.push({
          id: "fumadocs",
          type: "legacy",
          directory: "apps/fumadocs",
          roles: ["docs"],
          scope: "independent",
          stack: {},
          bindings: {},
          port,
          origin: `http://localhost:${port}`,
        });
      }
      return apps;
    },
    catch: (cause) =>
      new CLIError({
        message: `Failed to resolve workspace applications: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      }),
  });
}

/** Database credentials and runtime dependencies belong to exactly one backend. */
export async function resolveDatabaseApplication(
  config: ProjectConfig,
  provider: string,
): Promise<Result<WorkspaceApplication, DatabaseSetupError>> {
  const applications = await resolveWorkspaceApplications(config);
  if (applications.isErr()) {
    return Result.err(
      new DatabaseSetupError({
        provider,
        message: applications.error.message,
        cause: applications.error,
      }),
    );
  }
  const backends = applications.value.filter((app) => app.roles.includes("backend"));
  if (backends.length !== 1) {
    return Result.err(
      new DatabaseSetupError({
        provider,
        message: `Database setup requires exactly one backend application; found ${backends.length}`,
      }),
    );
  }
  return Result.ok(backends[0]!);
}
