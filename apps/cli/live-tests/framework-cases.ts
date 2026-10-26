import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  allowedApisForFrontends,
  isFrontendAllowedWithBackend,
  supportsRuntimeBackend,
  supportsServerDeployRuntime,
  validateAddonCompatibility,
  type API,
  type ApplicationManifest,
  type ApplicationSelection,
  type Auth,
  type CreateInput,
  type ProjectConfig,
} from "@xstack/types";

import {
  readApplicationCatalog,
  readFrameworkCatalog,
  type ResolvedFrameworkAdapter,
  type ResolvedApplicationAdapter,
} from "../../../packages/template-generator/src/apps/plan";
import { readModuleCatalog } from "../../../packages/template-generator/src/modules/metadata";
import { supportGaps } from "../../../packages/template-generator/src/modules/resolver";

export type Implementation = {
  framework: string;
  type: string;
  manifest: ApplicationManifest;
  adapter: ResolvedApplicationAdapter;
};
export type FrameworkCase = {
  id: string;
  framework: string;
  type: string;
  variant: string;
  auth: Auth;
  input: CreateInput;
};
export interface FrameworkCatalog {
  templates: Map<string, string>;
  applications: Map<string, ApplicationManifest>;
  frameworks: Map<string, ResolvedFrameworkAdapter>;
  implementations: Implementation[];
}

export async function frameworkCatalog(root: string) {
  const templates = new Map<string, string>();
  const directory = path.join(root, "packages/template-generator/templates");
  async function visit(relative: string) {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile())
        templates.set(name, await readFile(path.join(directory, name), "utf8"));
      else throw new Error(`Template inventory must not follow symlinks: ${name}`);
    }
  }
  await visit("");
  const applications = readApplicationCatalog(templates);
  const frameworks = readFrameworkCatalog(templates);
  const implementations: Implementation[] = [];
  for (const framework of [...frameworks.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const [type, adapter] of Object.entries(framework.apps).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const manifest = applications.get(type);
      assert.ok(manifest, `Missing application manifest: ${framework.id}/${type}`);
      implementations.push({ framework: framework.id, type, manifest, adapter });
    }
  }
  return { templates, applications, frameworks, implementations };
}

export function frameworkCases(catalog: FrameworkCatalog): FrameworkCase[] {
  const cases: FrameworkCase[] = [];
  const foundations = [...readModuleCatalog(catalog.templates).values()].filter(
    (module) => module.requiredWhen,
  );
  let nextCaseOrdinal = 1;
  for (const implementation of catalog.implementations) {
    const { framework, type, manifest, adapter } = implementation;
    const independent = manifest.scope === "independent";
    const frontends = adapter.stack.frontend ?? [];
    const apis = independent ? ["none" as const] : allowedApisForFrontends(frontends);
    for (const api of apis) add(`api-${api}`, api, "none");
    if (!independent) {
      for (const auth of ["better-auth", "clerk"] as const) {
        if (
          frontends.every((frontend) =>
            isFrontendAllowedWithBackend(frontend, adapter.stack.backend, auth),
          )
        )
          add(`auth-${auth}`, "none", auth);
      }
      if (manifest.roles.includes("backend")) {
        add("database-prisma-sqlite", "orpc", "none", { database: "sqlite", orm: "prisma" });
        add("database-drizzle-postgres", "none", "none", { database: "postgres", orm: "drizzle" });
        add("database-docker", "none", "none", {
          database: "postgres",
          orm: "drizzle",
          dbSetup: "docker",
        });
      }
      if (manifest.roles.some((role) => role === "web-frontend" || role === "backend")) {
        const field = manifest.roles.includes("web-frontend") ? "webDeploy" : "serverDeploy";
        for (const target of ["docker", "vercel", "cloudflare", "prisma"] as const) {
          const runtime = target === "cloudflare" ? "workers" : "node";
          if (
            field === "serverDeploy" &&
            (!supportsRuntimeBackend(runtime, adapter.stack.backend) ||
              !supportsServerDeployRuntime(target, runtime))
          )
            continue;
          add(`deploy-${target}`, "orpc", "none", { [field]: target });
        }
      }
      for (const addon of ["turborepo", "nx", "vite-plus", "pwa", "evlog", "biome"] as const) {
        if (
          validateAddonCompatibility(
            addon,
            frontends,
            "none",
            adapter.stack.backend,
            adapter.stack.runtime,
          ).isCompatible
        )
          add(`addon-${addon}`, "none", "none", { addons: [addon] });
      }
    }
    // A renamed independent app must coexist with product owners, not only work alone.
    if (!independent && manifest.roles.includes("backend"))
      add("independent-companions", "none", "none", {}, true);
    // Exercise both public/admin implementations of the same adapter in one workspace.
    if (manifest.roles.includes("web-frontend") && !manifest.roles.includes("backend")) {
      const candidates = catalog.implementations.filter(
        (candidate) =>
          candidate.framework === framework && candidate.manifest.roles.includes("admin"),
      );
      const sibling = candidates.find(
        (candidate) =>
          !candidate.manifest.roles.includes("web-frontend") &&
          !candidate.manifest.roles.includes("backend"),
      );
      if (sibling) add("same-framework-roles", "none", "none", {}, false, sibling);
      // Retain existing baseline instance names while removing invalid overlapping-role cases.
      else if (candidates.length) nextCaseOrdinal++;
    }

    function add(
      variant: string,
      api: API,
      auth: Auth,
      overrides: Partial<CreateInput> = {},
      companions = false,
      sibling?: Implementation,
    ) {
      const suffix = String(nextCaseOrdinal++).padStart(3, "0");
      const selections: ApplicationSelection[] = [];
      const addImplementation = (
        candidate: Implementation,
        label: string,
      ): ApplicationSelection => {
        const selection: ApplicationSelection = {
          id: `${label}-${suffix}`,
          type: candidate.type,
          stack: { framework: candidate.framework },
        };
        if (candidate.manifest.roles.includes("backend")) {
          selection.stack.api = api;
          const backend = candidate.adapter.stack.backend;
          if (backend && backend !== "self") {
            selection.stack.runtime =
              overrides.serverDeploy === "cloudflare"
                ? "workers"
                : supportsRuntimeBackend("node", backend)
                  ? "node"
                  : candidate.adapter.stack.runtime;
          }
        }
        selections.push(selection);
        return selection;
      };
      addImplementation(implementation, "quartz");
      if (sibling) addImplementation(sibling, "cobalt");
      if (companions) {
        for (const [index, candidate] of catalog.implementations
          .filter((entry) => entry.manifest.scope === "independent")
          .entries())
          addImplementation(candidate, `satellite-${index + 1}`);
      }
      // Resolve required role owners from declarations, never canonical application IDs.
      for (let index = 0; index < selections.length; index++) {
        const selection = selections[index]!;
        const declaration = catalog.applications.get(selection.type)!;
        for (const role of declaration.requires) {
          let owner = selections.find((candidate) =>
            catalog.applications.get(candidate.type)!.roles.includes(role),
          );
          if (!owner) {
            const candidate = catalog.implementations.find(
              (entry) =>
                entry.manifest.roles.includes(role) &&
                entry.manifest.roles.length === 1 &&
                allowedApisForFrontends(entry.adapter.stack.frontend ?? []).includes(api),
            );
            assert.ok(candidate, `No declared owner of ${role} for ${framework}/${type}`);
            owner = addImplementation(candidate, `harbor-${index + 1}`);
          }
          selection.bindings = { ...selection.bindings, [role]: owner.id };
        }
      }
      const ownsBackend = selections.some((selection) =>
        catalog.applications.get(selection.type)!.roles.includes("backend"),
      );
      const foundationStack = {
        projectName: "matrix",
        frontend: frontends,
        backend: adapter.stack.backend ?? "none",
        api,
        database: overrides.database ?? "none",
        orm: overrides.orm ?? "none",
        webDeploy: overrides.webDeploy ?? "none",
      } satisfies Pick<
        ProjectConfig,
        "projectName" | "frontend" | "backend" | "api" | "database" | "orm" | "webDeploy"
      >;
      const nativeFoundation = foundations.find(
        (module) => !supportGaps(module.requiredWhen, foundationStack, module.id).length,
      );
      cases.push({
        id: `${framework}-${type}-${variant}`,
        framework,
        type,
        variant,
        auth,
        input: {
          projectName: `matrix-${framework}-${type}-${variant}`,
          apps: selections,
          database: ownsBackend
            ? (overrides.database ??
              (auth === "better-auth"
                ? "sqlite"
                : (nativeFoundation?.supports?.dialects?.[0] ?? "none")))
            : "none",
          orm: ownsBackend
            ? (overrides.orm ??
              (auth === "better-auth"
                ? "drizzle"
                : (nativeFoundation?.supports?.orms?.[0] ?? "none")))
            : "none",
          dbSetup: "none",
          dbSetupOptions: { mode: "manual" },
          api,
          addons: ["none"],
          webDeploy: "none",
          serverDeploy: "none",
          packageManager: "bun",
          git: false,
          install: false,
          directoryConflict: "error",
          disableAnalytics: true,
          product:
            auth === "none"
              ? { features: [] }
              : {
                  features: ["auth"],
                  providers: { auth: [] },
                  options: { auth: { engine: auth } },
                },
          ...overrides,
        },
      });
    }
  }
  return cases;
}

export function frameworkProjectConfig(test: FrameworkCase, project: string): ProjectConfig {
  return {
    projectName: path.basename(project),
    projectDir: project,
    relativePath: path.basename(project),
    backend: "none",
    frontend: ["none"],
    runtime: "none",
    database: "none",
    orm: "none",
    dbSetup: "none",
    api: "none",
    addons: ["none"],
    webDeploy: "none",
    serverDeploy: "none",
    git: false,
    install: false,
    packageManager: "bun",
    ...test.input,
  } as ProjectConfig;
}
