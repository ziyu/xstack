import {
  ApplicationManifestSchema,
  ApplicationSelectionSchema,
  FrameworkAdapterSchema,
  allowedApisForFrontends,
  supportsRuntimeBackend,
  type ApplicationAdapter,
  type FrameworkAdapter,
  type ApplicationManifest,
  type ApplicationSelection,
} from "@xstack/types";

import { GeneratorError } from "../types";
import { isApplicationMetadataPath } from "./metadata";

/** Rendering paths are derived from the template layout, never supplied by metadata. */
export interface ResolvedApplicationAdapter extends ApplicationAdapter {
  layers: { source: string; target: string }[];
}

export interface ResolvedFrameworkAdapter extends Omit<FrameworkAdapter, "apps"> {
  apps: Record<string, ResolvedApplicationAdapter>;
}

export interface ApplicationIssue {
  code: string;
  message: string;
  app?: string;
}

export interface ResolvedApplication {
  selection: ApplicationSelection;
  manifest: ApplicationManifest;
  adapter: ResolvedApplicationAdapter;
  product?: string;
  bindings: Record<string, string>;
}

export interface ApplicationPlan {
  apps: ResolvedApplication[];
  issues: ApplicationIssue[];
}

/** Only manifests in the supplied template map define available applications. */
export function readApplicationCatalog(
  templates: Map<string, string>,
): Map<string, ApplicationManifest> {
  const catalog = new Map<string, ApplicationManifest>();
  for (const [path, content] of templates) {
    const match = /^apps\/([^/]+)\/app\.json$/.exec(path);
    if (!match) continue;

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch (cause) {
      throw new GeneratorError({
        message: `Invalid application manifest JSON at ${path}`,
        phase: "applications",
        cause,
      });
    }
    const parsed = ApplicationManifestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new GeneratorError({
        message: `Invalid application manifest at ${path}: ${parsed.error.message}`,
        phase: "applications",
        cause: parsed.error,
      });
    }
    const manifest = parsed.data;
    if (manifest.id !== match[1]) {
      throw new GeneratorError({
        message: `Application manifest ID ${manifest.id} must match its directory at ${path}`,
        phase: "applications",
      });
    }
    catalog.set(manifest.id, manifest);
  }
  return catalog;
}

/** Discover technology-owned implementations and derive their rendering destinations. */
export function readFrameworkCatalog(
  templates: Map<string, string>,
): Map<string, ResolvedFrameworkAdapter> {
  const catalog = new Map<string, ResolvedFrameworkAdapter>();
  const implementationDirectories = new Set<string>();
  for (const [path, content] of templates) {
    if (isApplicationMetadataPath(path) || /(?:^|\/)\.(?:gitkeep|keep)$/.test(path)) continue;
    if (!content.trim()) continue;
    let separator = path.lastIndexOf("/");
    while (separator > 0) {
      implementationDirectories.add(path.slice(0, separator));
      separator = path.lastIndexOf("/", separator - 1);
    }
  }

  for (const [path, content] of templates) {
    const match = /^((?:frontend|backend|cli)(?:\/.*)?)\/adapter\.json$/.exec(path);
    if (!match) continue;
    const root = match[1]!;
    if (
      /[\\:]/.test(root) ||
      [...root].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      root.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      throw new GeneratorError({
        phase: "applications",
        message: `Invalid framework adapter directory at ${path}`,
      });
    }
    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch (cause) {
      throw new GeneratorError({
        message: `Invalid framework adapter JSON at ${path}`,
        phase: "applications",
        cause,
      });
    }
    const parsed = FrameworkAdapterSchema.safeParse(raw);
    if (!parsed.success) {
      throw new GeneratorError({
        message: `Invalid framework adapter at ${path}: ${parsed.error.message}`,
        phase: "applications",
        cause: parsed.error,
      });
    }
    const framework = parsed.data;
    if (catalog.has(framework.id)) {
      throw new GeneratorError({
        message: `Duplicate framework adapter ID ${framework.id} at ${path}`,
        phase: "applications",
      });
    }

    const appPrefix = `${root}/apps/`;
    const filesPrefix = `${root}/files`;
    for (const key of templates.keys()) {
      if (key.startsWith(`${filesPrefix}/apps/`)) {
        throw new GeneratorError({
          phase: "applications",
          message: `Framework ${framework.id} must declare application contributions in ${root}/apps, not ${filesPrefix}/apps`,
        });
      }
      if (!key.startsWith(appPrefix)) continue;
      const type = key.slice(appPrefix.length).split("/")[0]!;
      if (!Object.hasOwn(framework.apps, type)) {
        throw new GeneratorError({
          phase: "applications",
          message: `Framework ${framework.id} has undeclared application directory ${appPrefix}${type}`,
        });
      }
    }

    const sharedSources: string[] = [];
    const segments = root.split("/");
    for (let depth = 1; depth <= segments.length; depth++) {
      const source = `${segments.slice(0, depth).join("/")}/shared`;
      if (implementationDirectories.has(source)) sharedSources.push(source);
    }
    const apps: Record<string, ResolvedApplicationAdapter> = Object.create(null);
    for (const [type, adapter] of Object.entries(framework.apps)) {
      const source = `${appPrefix}${type}`;
      if (!implementationDirectories.has(source)) {
        throw new GeneratorError({
          phase: "applications",
          message: `Framework ${framework.id} application ${type} has no implementation files at ${source}`,
        });
      }
      const target = `apps/${type}`;
      const layers = sharedSources.map((shared) => ({ source: shared, target }));
      layers.push({ source, target });
      // files/ is already workspace-relative; shared/ and apps/<type>/ are app-relative.
      if (implementationDirectories.has(filesPrefix)) {
        layers.push({ source: filesPrefix, target: "" });
      }
      apps[type] = { ...adapter, layers };
    }
    catalog.set(framework.id, { ...framework, apps });
  }
  return catalog;
}

/** Resolve ownership and dependencies without writing any generated files. */
export function resolveApplications(
  selections: ApplicationSelection[],
  templates: Map<string, string>,
): ApplicationPlan {
  const catalog = readApplicationCatalog(templates);
  const frameworks = readFrameworkCatalog(templates);
  const apps: ResolvedApplication[] = [];
  const issues: ApplicationIssue[] = [];
  const ids = new Set<string>();
  const appsById = new Map<string, ResolvedApplication>();
  const owners = new Map<string, Map<string, ResolvedApplication[]>>();

  for (const input of selections) {
    const parsed = ApplicationSelectionSchema.safeParse(input);
    if (!parsed.success) {
      issues.push({
        code: "invalid-selection",
        message: `Invalid application selection: ${parsed.error.message}`,
      });
      continue;
    }
    const selection = parsed.data;
    const id = selection.id;
    if (ids.has(id)) {
      issues.push({
        code: "duplicate-app",
        app: id,
        message: `Application ID ${id} is duplicated`,
      });
      continue;
    }
    ids.add(id);
    const manifest = catalog.get(selection.type);
    if (!manifest) {
      issues.push({
        code: "unknown-type",
        app: id,
        message: `Unknown application type ${selection.type} for ${id}`,
      });
      continue;
    }
    const frameworkId = selection.stack.framework;
    const framework = frameworkId ? frameworks.get(frameworkId) : undefined;
    if (!framework) {
      issues.push({
        code: frameworkId ? "unknown-framework" : "missing-framework",
        app: id,
        message: frameworkId
          ? `Unknown framework ${frameworkId} for ${id}`
          : `Application ${id} requires an explicit stack.framework`,
      });
      continue;
    }
    const implementation = Object.hasOwn(framework.apps, selection.type)
      ? framework.apps[selection.type]
      : undefined;
    if (!implementation) {
      issues.push({
        code: "unsupported-app-type",
        app: id,
        message: `Framework ${framework.id} does not implement application type ${selection.type}`,
      });
      continue;
    }
    const stack = { ...implementation.stack };
    if (selection.stack.runtime !== undefined) stack.runtime = selection.stack.runtime;
    if (selection.stack.api !== undefined) stack.api = selection.stack.api;
    const runtimeSupported =
      stack.backend && stack.backend !== "none"
        ? supportsRuntimeBackend(stack.runtime, stack.backend)
        : (stack.runtime ?? "none") === (implementation.stack.runtime ?? "none");
    const apiSupported =
      (!stack.api ||
        stack.api === "none" ||
        (stack.backend && !["none", "convex"].includes(stack.backend))) &&
      allowedApisForFrontends(stack.frontend).includes(stack.api ?? "none");
    if (!runtimeSupported || !apiSupported) {
      issues.push({
        code: "unsupported-stack",
        app: id,
        message: `Framework ${framework.id} application ${selection.type} does not support runtime ${stack.runtime ?? "none"} and API ${stack.api ?? "none"}`,
      });
      continue;
    }

    const app: ResolvedApplication = {
      selection,
      manifest,
      adapter: { ...implementation, stack },
      bindings: Object.create(null) as Record<string, string>,
    };
    if (manifest.scope === "product") {
      app.product = selection.product ?? "main";
    }
    apps.push(app);
    appsById.set(id, app);

    if (manifest.scope === "independent") {
      if (selection.product !== undefined || selection.bindings !== undefined) {
        issues.push({
          code: "independent-app",
          app: id,
          message: `Independent application ${id} cannot declare a product or bindings`,
        });
      }
      continue;
    }

    const product = app.product!;
    let productOwners = owners.get(product);
    if (!productOwners) {
      productOwners = new Map();
      owners.set(product, productOwners);
    }
    for (const role of manifest.roles) {
      const roleOwners = productOwners.get(role);
      if (roleOwners) {
        issues.push({
          code: "role-conflict",
          app: id,
          message: `Product ${product} role ${role} is already owned by ${roleOwners.map((owner) => owner.selection.id).join(", ")}; ${id} cannot also own it`,
        });
        roleOwners.push(app);
      } else {
        productOwners.set(role, [app]);
      }
    }
  }

  for (const app of apps) {
    if (app.manifest.scope === "independent") continue;
    const id = app.selection.id;
    const requiredRoles = new Set(app.manifest.requires);
    for (const role of Object.keys(app.selection.bindings ?? {})) {
      if (!requiredRoles.has(role)) {
        issues.push({
          code: "unexpected-binding",
          app: id,
          message: `Application ${id} does not require role ${role}`,
        });
      }
    }

    for (const role of requiredRoles) {
      const declaredBindings = app.selection.bindings;
      const explicitTarget =
        declaredBindings && Object.hasOwn(declaredBindings, role)
          ? declaredBindings[role]
          : undefined;
      if (explicitTarget !== undefined) {
        const target = appsById.get(explicitTarget);
        if (!target) {
          issues.push({
            code: "unknown-binding",
            app: id,
            message: `Application ${id} binds ${role} to unknown application ${explicitTarget}`,
          });
        } else if (target.manifest.scope !== "product" || target.product !== app.product) {
          issues.push({
            code: "cross-product-binding",
            app: id,
            message: `Application ${id} must bind ${role} to an application in product ${app.product}; ${explicitTarget} is not in that product`,
          });
        } else if (!target.manifest.roles.includes(role)) {
          issues.push({
            code: "wrong-role-binding",
            app: id,
            message: `Application ${explicitTarget} does not own required role ${role} for ${id}`,
          });
        } else {
          app.bindings[role] = explicitTarget;
        }
        continue;
      }

      const candidates = owners.get(app.product!)?.get(role) ?? [];
      if (candidates.length === 1) {
        app.bindings[role] = candidates[0]!.selection.id;
      } else {
        issues.push({
          code: candidates.length === 0 ? "missing-role" : "ambiguous-binding",
          app: id,
          message:
            candidates.length === 0
              ? `Application ${id} requires role ${role}, but product ${app.product} has no owner`
              : `Application ${id} requires an explicit binding for role ${role}; product ${app.product} has multiple owners`,
        });
      }
    }
  }

  for (const app of apps) {
    const backendId = app.bindings.backend;
    const backend = backendId ? appsById.get(backendId) : undefined;
    if (
      backend &&
      !allowedApisForFrontends(app.adapter.stack.frontend).includes(
        backend.adapter.stack.api ?? "none",
      )
    ) {
      issues.push({
        code: "unsupported-stack",
        app: app.selection.id,
        message: `Application ${app.selection.id} does not support backend API ${backend.adapter.stack.api}`,
      });
    }
  }

  const active = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  function visit(app: ResolvedApplication): void {
    const id = app.selection.id;
    if (active.has(id)) {
      issues.push({
        code: "binding-cycle",
        app: id,
        message: `Application binding cycle: ${[...path.slice(path.indexOf(id)), id].join(" -> ")}`,
      });
      return;
    }
    if (visited.has(id)) return;
    active.add(id);
    path.push(id);
    for (const targetId of Object.values(app.bindings)) {
      const target = appsById.get(targetId);
      if (target) visit(target);
    }
    path.pop();
    active.delete(id);
    visited.add(id);
  }
  for (const app of apps) visit(app);

  return { apps, issues };
}
