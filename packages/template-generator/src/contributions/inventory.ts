import { FrameworkAdapterSchema } from "@xstack/types";

import { readApplicationCatalog, readFrameworkCatalog } from "../apps/plan";
import { readBuilderDefinition } from "../builder";
import { readModuleCatalog } from "../modules/catalog";
import type { ModuleManifest } from "../modules/types";
import { GeneratorError } from "../types";

export type ContributionFamily =
  | "application"
  | "framework"
  | "module"
  | "api"
  | "addon"
  | "deployment"
  | "database"
  | "workspace"
  | "environment";

/** Source ownership is not a generated workspace path or a claim of business capability. */
export interface ContributionEntry {
  source: string;
  family: ContributionFamily;
  owner: string;
  appType?: string;
  module?: string;
  variant?: string;
  framework?: string;
  provider?: string;
  integration?: string;
  dialect?: string;
  legacy?: boolean;
  /** Metadata and empty keep files are inventoried, but cannot satisfy an implementation. */
  implementation: boolean;
}

export type ContributionIssueCode =
  | "invalid-path"
  | "unknown-root"
  | "unknown-contribution"
  | "unknown-app-type"
  | "unknown-module"
  | "unknown-framework"
  | "unknown-provider"
  | "unknown-integration"
  | "unknown-dialect"
  | "invalid-application-catalog"
  | "invalid-framework-catalog"
  | "invalid-module-catalog"
  | "missing-contribution";

export interface ContributionIssue {
  code: ContributionIssueCode;
  source: string;
  message: string;
}

export interface ContributionInventory {
  entries: ContributionEntry[];
  issues: ContributionIssue[];
}

export type ContributionQuery = Partial<
  Pick<
    ContributionEntry,
    | "family"
    | "owner"
    | "appType"
    | "module"
    | "variant"
    | "framework"
    | "provider"
    | "integration"
    | "dialect"
    | "legacy"
    | "implementation"
  >
> & { sourcePrefix?: string };

export interface ContributionRequirement extends ContributionQuery {
  /** Diagnostic source: the selected declaration, not a fabricated template filename. */
  source: string;
}

export interface ContributionMatrixRow {
  family: ContributionFamily;
  owner: string;
  module?: string;
  framework?: string;
  appTypes: string[];
  files: number;
  legacyFiles: number;
}

const TECHNOLOGY_ROOTS = { frontend: true, backend: true, cli: true };
const MODULE_LAYERS = {
  files: true,
  frameworks: true,
  providers: true,
  integrations: true,
  dialects: true,
  apps: true,
};
const PAYLOAD_ROOTS = { packages: true, docs: true };

/** Inventory every source independently of which applications happen to be selected. */
export function inventoryContributions(templates: Map<string, string>): ContributionInventory {
  const entries: ContributionEntry[] = [];
  const issues: ContributionIssue[] = [];
  const issue = (code: ContributionIssueCode, source: string, message: string) => {
    issues.push({ code, source, message });
  };
  let modules: ReadonlyMap<string, ModuleManifest> = new Map();
  try {
    modules = readModuleCatalog(templates);
  } catch (error) {
    issue(
      "invalid-module-catalog",
      "modules",
      error instanceof Error ? error.message : String(error),
    );
  }
  const appTypes = new Set<string>();
  for (const [source, content] of templates) {
    if (!/^apps\/[^/]+\/app\.json$/.test(source)) continue;
    try {
      for (const type of readApplicationCatalog(new Map([[source, content]])).keys())
        appTypes.add(type);
    } catch (error) {
      issue(
        "invalid-application-catalog",
        source,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  let frameworks = new Set<string>();
  try {
    const catalog = readFrameworkCatalog(templates);
    frameworks = new Set([
      ...catalog.keys(),
      ...[...catalog.values()].flatMap((framework) =>
        Object.values(framework.apps).flatMap(
          (app) => app.productContribution?.frameworks.map((layer) => layer.id) ?? [],
        ),
      ),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const source =
      [...templates.keys()].find(
        (path) => path.endsWith("/adapter.json") && message.includes(path),
      ) ??
      [...templates.keys()].find(
        (path) => path.endsWith("/adapter.json") && message.includes(path.slice(0, -13)),
      ) ??
      "frontend";
    issue("invalid-framework-catalog", source, message);
  }
  const adapters = new Map<string, string>();
  const sharedRoots = new Set<string>();
  for (const [source, content] of templates) {
    if (!/^(frontend|backend|cli)\/.+\/adapter\.json$/.test(source)) continue;
    try {
      const parsed = FrameworkAdapterSchema.safeParse(JSON.parse(content));
      if (!parsed.success) continue;
      const root = source.slice(0, -"/adapter.json".length);
      adapters.set(root, parsed.data.id);
      const parts = root.split("/");
      for (let depth = 1; depth <= parts.length; depth++)
        sharedRoots.add(`${parts.slice(0, depth).join("/")}/shared`);
    } catch {
      // readFrameworkCatalog above reports malformed adapter metadata.
    }
  }

  const validateApp = (source: string, type: string | undefined) => {
    if (type && appTypes.has(type)) return true;
    issue(
      "unknown-app-type",
      source,
      `Unknown application contribution type ${type ?? "(missing)"} at ${source}`,
    );
    return false;
  };

  for (const [source, content] of templates) {
    const parts = source.split("/");
    const root = parts[0]!;
    if (
      /[\\:]/.test(source) ||
      [...source].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      parts.some((part) => !part || part === "." || part === "..")
    ) {
      issue("invalid-path", source, `Invalid contribution source path ${source}`);
      continue;
    }
    const implementation = content.trim().length > 0 && !/(?:^|\/)\.(?:keep|gitkeep)$/.test(source);
    let entry: ContributionEntry | undefined;
    const create = (
      family: ContributionFamily,
      owner: string,
      variant?: string,
    ): ContributionEntry => {
      const contribution: ContributionEntry = { source, family, owner, implementation };
      if (variant) contribution.variant = variant;
      return contribution;
    };
    if (source === "builder.json" || source === "modules/presets.json") {
      entry = { ...create("workspace", "workspace:metadata", "metadata"), implementation: false };
      if (source === "builder.json") {
        try {
          readBuilderDefinition(templates);
        } catch (error) {
          issue(
            "unknown-contribution",
            source,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    } else if (root === "apps") {
      if (parts.length === 3 && parts[2] === "app.json") {
        entry = {
          ...create("application", `application:${parts[1]}`, "metadata"),
          appType: parts[1],
          implementation: false,
        };
      }
    } else if (root === "modules") {
      const module = parts[1]!;
      const manifest = modules.get(module);
      entry = { ...create("module", `module:${module}`, "native"), module };
      if (!manifest) issue("unknown-module", source, `Unknown module ${module} at ${source}`);
      if (parts.length === 3 && parts[2] === "module.json") {
        entry.implementation = false;
        entry.variant = "metadata";
      } else if (parts[2] === "stack") {
        entry.variant = "stack";
        // Stack engines (better-auth/clerk) are not native module provider IDs.
        const engine = parts[3];
        const option = manifest?.options?.engine;
        if (option?.type !== "enum" || !engine || !option.values.includes(engine)) {
          issue(
            "unknown-contribution",
            source,
            `Unknown stack engine ${engine ?? "(missing)"} at ${source}`,
          );
        }
        const section = parts[4] === "convex" ? 5 : 4;
        const branch = parts[section];
        if (branch === "apps") {
          entry.appType = parts[section + 1];
          validateApp(source, entry.appType);
          if (parts[section + 2] === "frameworks") entry.framework = parts[section + 3];
        } else if (
          branch === "shared" &&
          parts[section + 1] === "client" &&
          parts[section + 2] === "frameworks"
        ) {
          entry.framework = parts[section + 3];
        } else if (branch === "web" || branch === "native" || branch === "fullstack") {
          entry.legacy = true;
          entry.variant = `legacy-${branch}`;
          entry.framework = branch === "native" ? undefined : parts[section + 1];
        } else if (
          !["client", "loaders", "server"].includes(branch ?? "") &&
          !(parts[4] === "convex" && branch === "backend" && parts[section + 1] === "convex")
        ) {
          issue("unknown-contribution", source, `Unknown stack contribution branch at ${source}`);
        }
      } else {
        let cursor = 2;
        let payload = false;
        while (cursor < parts.length - 1) {
          const layer = parts[cursor]!;
          if (layer === "files") {
            cursor++;
            continue;
          }
          if (layer === "shared" && parts[cursor + 1] === "partials") {
            payload = cursor + 2 < parts.length && source.endsWith(".hbs");
            break;
          }
          if (
            layer === "shared" &&
            parts[cursor + 1] === "client" &&
            parts[cursor + 2] === "frameworks"
          ) {
            entry.framework = parts[cursor + 3];
            if (!entry.framework || !frameworks.has(entry.framework)) {
              issue("unknown-framework", source, `Unknown shared client framework at ${source}`);
            }
            payload = cursor + 4 < parts.length;
            break;
          }
          if (layer === "apps") {
            entry.appType = parts[cursor + 1];
            validateApp(source, entry.appType);
            payload = cursor + 2 < parts.length;
            break;
          }
          if (Object.hasOwn(PAYLOAD_ROOTS, layer)) {
            payload = cursor + 1 < parts.length;
            break;
          }
          const value = parts[cursor + 1];
          if (!Object.hasOwn(MODULE_LAYERS, layer) || !value) break;
          if (layer === "frameworks") {
            entry.framework = value;
            if (!frameworks.has(value) && value !== "react" && value !== "http-server") {
              issue("unknown-framework", source, `Unknown module framework ${value} at ${source}`);
            }
          } else if (layer === "providers") {
            entry.provider = value;
            if (!manifest?.providers || !Object.hasOwn(manifest.providers.options, value)) {
              issue("unknown-provider", source, `Unknown provider ${module}:${value} at ${source}`);
            }
          } else if (layer === "integrations") {
            entry.integration = value;
            if (!modules.has(value) || !manifest?.enhances?.includes(value)) {
              issue(
                "unknown-integration",
                source,
                `Undeclared integration ${module}:${value} at ${source}`,
              );
            }
          } else if (layer === "dialects") {
            entry.dialect = value;
            if (value !== "sqlite" && value !== "postgres") {
              issue("unknown-dialect", source, `Unknown module dialect ${value} at ${source}`);
            }
          }
          cursor += 2;
        }
        if (!payload)
          issue("unknown-contribution", source, `Unknown module contribution layout at ${source}`);
      }
    } else if (Object.hasOwn(TECHNOLOGY_ROOTS, root)) {
      const adapterRoot = [...adapters.keys()].find((prefix) => source.startsWith(`${prefix}/`));
      const sharedRoot = [...sharedRoots].find((prefix) => source.startsWith(`${prefix}/`));
      if (adapterRoot) {
        const framework = adapters.get(adapterRoot)!;
        const relative = source.slice(adapterRoot.length + 1).split("/");
        entry = { ...create("framework", `framework:${framework}`, relative[0]), framework };
        if (relative[0] === "adapter.json") {
          entry.variant = "metadata";
          entry.implementation = false;
        } else if (relative[0] === "apps") {
          entry.appType = relative[1];
          validateApp(source, entry.appType);
        } else if (relative[0] !== "shared" && relative[0] !== "files") {
          issue(
            "unknown-contribution",
            source,
            `Unknown framework contribution layout at ${source}`,
          );
        }
      } else if (sharedRoot) {
        entry = create("framework", `framework-shared:${sharedRoot.slice(0, -7)}`, "shared");
      } else if (source.startsWith("backend/convex/packages/backend/")) {
        entry = { ...create("framework", "framework:convex", "stack"), framework: "convex" };
      }
    } else if (root === "api" && (parts[1] === "orpc" || parts[1] === "trpc")) {
      entry = create("api", `api:${parts[1]}`, parts[2]);
      if (parts[2] === "apps") {
        entry.appType = parts[3];
        validateApp(source, entry.appType);
        if (parts[4] === "frameworks") entry.framework = parts[5];
      } else if (parts[2] === "shared" && parts[3] === "client" && parts[4] === "frameworks") {
        entry.framework = parts[5];
      } else if (parts[2] === "shared" && parts[3] === "server" && parts[4] === "svelte") {
        entry.framework = "svelte";
      } else if (["web", "native", "fullstack"].includes(parts[2]!)) {
        entry.legacy = true;
        entry.variant = `legacy-${parts[2]}`;
        entry.framework = parts[2] === "native" ? undefined : parts[3];
      } else if (parts[2] !== "server" && !(parts.length === 3 && parts[2] === "context.ts.hbs")) {
        issue("unknown-contribution", source, `Unknown API contribution layout at ${source}`);
      }
    } else if (root === "addons" && parts.length > 2) {
      entry = create("addon", `addon:${parts[1]}`);
      if (parts[2] === "apps") {
        if (parts[1] === "electrobun" && parts[3] === "desktop") {
          entry.variant = "legacy-desktop";
          entry.legacy = true;
        } else {
          entry.appType = parts[3];
          validateApp(source, entry.appType);
        }
      } else if (parts[2] === "packages") {
        entry.variant = "package";
      }
    } else if (root === "deploy" && parts.length > 2) {
      entry = create("deployment", `deployment:${parts[1]}`, parts[2]);
      if (parts[2] === "apps") {
        entry.appType = parts[3];
        validateApp(source, entry.appType);
      } else if (parts[2] === "shared" && parts[3] === "client" && parts[4] === "frameworks") {
        entry.framework = parts[5] === "react" ? parts[6] : parts[5];
        if (!entry.framework || !frameworks.has(entry.framework)) {
          issue("unknown-framework", source, `Unknown deployment client framework at ${source}`);
        }
      } else if (parts[2] === "web" || parts[2] === "server") {
        entry.variant = `legacy-${parts[2]}`;
        entry.legacy = true;
      }
    } else if ((root === "db" || root === "db-setup") && parts.length > 2) {
      entry = create("database", `${root}:${parts[1]}`, parts[2]);
    } else if (root === "base" || root === "extras" || (root === "packages" && parts.length > 2)) {
      entry = create(
        "workspace",
        root === "packages" ? `package:${parts[1]}` : `workspace:${root}`,
      );
    } else if (root === "env" && parts.length > 1) {
      entry = create("environment", "environment:shared");
    }
    if (entry) entries.push(entry);
    else {
      const knownRoot =
        Object.hasOwn(TECHNOLOGY_ROOTS, root) ||
        [
          "apps",
          "modules",
          "api",
          "addons",
          "deploy",
          "db",
          "db-setup",
          "base",
          "extras",
          "packages",
          "env",
        ].includes(root);
      issue(
        knownRoot ? "unknown-contribution" : "unknown-root",
        source,
        `Unclassified contribution source ${source}`,
      );
    }
  }
  entries.sort((left, right) => left.source.localeCompare(right.source));
  issues.sort(
    (left, right) => left.source.localeCompare(right.source) || left.code.localeCompare(right.code),
  );
  return { entries, issues };
}

export function queryContributions(
  inventory: ContributionInventory,
  query: ContributionQuery = {},
): ContributionEntry[] {
  const { sourcePrefix, ...fields } = query;
  return inventory.entries.filter(
    (entry) =>
      (!sourcePrefix ||
        entry.source === sourcePrefix ||
        entry.source.startsWith(`${sourcePrefix}/`)) &&
      Object.entries(fields).every(([key, value]) =>
        key === "legacy"
          ? Boolean(entry.legacy) === value
          : entry[key as keyof ContributionEntry] === value,
      ),
  );
}

/** A structural matrix only: these files do not prove end-to-end business support. */
export function contributionMatrix(inventory: ContributionInventory): ContributionMatrixRow[] {
  const rows = new Map<string, ContributionMatrixRow>();
  for (const entry of inventory.entries) {
    if (!entry.implementation) continue;
    const key = JSON.stringify([entry.family, entry.owner, entry.framework]);
    let row = rows.get(key);
    if (!row) {
      row = {
        family: entry.family,
        owner: entry.owner,
        module: entry.module,
        framework: entry.framework,
        appTypes: [],
        files: 0,
        legacyFiles: 0,
      };
      rows.set(key, row);
    }
    row.files++;
    if (entry.legacy) row.legacyFiles++;
    if (entry.appType && !row.appTypes.includes(entry.appType)) row.appTypes.push(entry.appType);
  }
  for (const row of rows.values()) row.appTypes.sort();
  return [...rows.values()];
}

/** Requirements are explicit: a provider implemented inside base files needs no provider directory. */
export function validateContributionRequirements(
  inventory: ContributionInventory,
  requirements: readonly ContributionRequirement[],
): ContributionIssue[] {
  return requirements.flatMap(({ source, ...query }) =>
    queryContributions(inventory, { ...query, implementation: true }).length > 0
      ? []
      : [
          {
            code: "missing-contribution" as const,
            source,
            message: `Missing required contribution for ${source}: ${JSON.stringify(query)}`,
          },
        ],
  );
}

export function assertContributionInventory(
  templatesOrInventory: Map<string, string> | ContributionInventory,
  requirements: readonly ContributionRequirement[] = [],
): ContributionInventory {
  const inventory =
    templatesOrInventory instanceof Map
      ? inventoryContributions(templatesOrInventory)
      : templatesOrInventory;
  const issues = [
    ...inventory.issues,
    ...validateContributionRequirements(inventory, requirements),
  ];
  if (issues.length > 0) {
    throw new GeneratorError({
      phase: "contributions",
      message: issues
        .map((issue) => `[${issue.code}] ${issue.source}: ${issue.message}`)
        .join("\n"),
      cause: issues,
    });
  }
  return inventory;
}
