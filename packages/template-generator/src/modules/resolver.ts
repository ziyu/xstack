import type { ProductConfig } from "@xstack/types";

import type {
  DeployTarget,
  Dialect,
  ModuleManifest,
  ModuleOptionValues,
  ModuleSelection,
  ResolvedModule,
  ResolvedPlan,
  ResolveIssue,
  StackContext,
  Support,
  Variant,
} from "./types";

export function toSelection(product: ProductConfig | undefined): ModuleSelection {
  return {
    features: [...new Set(product?.features ?? [])],
    providers: product?.providers ?? {},
    options: product?.options ?? {},
  };
}

export function toDeployTarget(webDeploy: StackContext["webDeploy"]): DeployTarget {
  if (webDeploy === "vercel" || webDeploy === "docker" || webDeploy === "cloudflare") {
    return webDeploy;
  }
  return "none";
}

function toDialect(database: StackContext["database"]): Dialect | undefined {
  if (database === "sqlite" || database === "postgres") return database;
  return undefined;
}

function oneOf<T>(allowed: readonly T[] | undefined, value: T): boolean {
  return !allowed || allowed.includes(value);
}

/** Messages for each way `stack` falls outside `support`. */
function supportGaps(support: Support | undefined, stack: StackContext, subject: string): string[] {
  if (!support) return [];
  const gaps: string[] = [];
  if (support.frameworks && !stack.frontend.some((f) => support.frameworks!.includes(f))) {
    gaps.push(`${subject} requires one of these frameworks: ${support.frameworks.join(", ")}`);
  }
  if (!oneOf(support.backends, stack.backend)) {
    gaps.push(`${subject} requires one of these backends: ${support.backends!.join(", ")}`);
  }
  if (!oneOf(support.orms, stack.orm)) {
    gaps.push(`${subject} requires one of these ORMs: ${support.orms!.join(", ")}`);
  }
  if (!oneOf(support.apis, stack.api)) {
    gaps.push(`${subject} requires one of these API layers: ${support.apis!.join(", ")}`);
  }
  const dialect = toDialect(stack.database);
  if (support.dialects && (!dialect || !support.dialects.includes(dialect))) {
    gaps.push(`${subject} requires one of these databases: ${support.dialects.join(", ")}`);
  }
  const target = toDeployTarget(stack.webDeploy);
  if (support.targets && target !== "none" && !support.targets.includes(target)) {
    gaps.push(
      `${subject} cannot be deployed to ${target} (supported: ${support.targets.join(", ")})`,
    );
  }
  return gaps;
}

type Entry = {
  manifest: ModuleManifest;
  variant: Variant;
  providers: string[];
  options: ModuleOptionValues;
  requires: string[];
};

type Attempt = { plan: ResolvedPlan; entries: Map<string, Entry> } | { forceStack: string };

/**
 * Expands a feature selection into an ordered, validated module plan.
 * Pure: shared by the CLI, the web builder and the generator.
 *
 * Each module uses its native implementation where the stack and its providers allow,
 * and otherwise falls back to the stack templates (`domain.stack`). A plan cannot mix:
 * modules with only a native implementation are errors next to a stack fallback.
 */
export function resolveModules(
  selection: ModuleSelection,
  stack: StackContext,
  catalog: ReadonlyMap<string, ModuleManifest>,
): ResolvedPlan {
  const forced = new Set<string>();
  for (;;) {
    const attempt = resolveAttempt(selection, stack, catalog, forced);
    if ("plan" in attempt) return attempt.plan;
    forced.add(attempt.forceStack);
  }
}

function resolveAttempt(
  selection: ModuleSelection,
  stack: StackContext,
  catalog: ReadonlyMap<string, ModuleManifest>,
  forced: ReadonlySet<string>,
): Attempt {
  const issues: ResolveIssue[] = [];
  const notes: string[] = [];
  const reasons = new Map<string, ResolvedModule["reason"]>();
  const entries = new Map<string, Entry>();

  const queue: string[] = [];
  for (const id of selection.features) {
    if (!catalog.has(id)) {
      issues.push({ level: "error", module: id, message: `Unknown feature module "${id}"` });
      continue;
    }
    reasons.set(id, { kind: "selected" });
    queue.push(id);
  }

  const drain = () => {
    while (queue.length) {
      const id = queue.shift()!;
      const entry = resolveEntry(catalog.get(id)!, selection, stack, forced.has(id), issues, notes);
      entries.set(id, entry);
      for (const dep of entry.requires) {
        if (!catalog.has(dep)) {
          issues.push({ level: "error", module: id, message: `Requires unknown module "${dep}"` });
          continue;
        }
        if (reasons.has(dep)) continue;
        reasons.set(dep, { kind: "required-by", by: id });
        notes.push(`Added "${dep}" because "${id}" requires it`);
        queue.push(dep);
      }
    }
  };
  drain();

  const stackModules = [...entries.values()].filter((entry) => entry.variant === "stack");
  for (const entry of stackModules) {
    for (const dep of entry.requires) {
      const other = entries.get(dep);
      if (other?.variant === "native" && other.manifest.domain?.stack && !forced.has(dep)) {
        return { forceStack: dep };
      }
    }
  }

  if (stackModules.length) {
    const fallback = stackModules.map((entry) => `"${entry.manifest.id}"`).join(", ");
    const verb = stackModules.length > 1 ? "fall" : "falls";
    for (const entry of entries.values()) {
      if (entry.variant === "native" && !entry.manifest.hidden) {
        issues.push({
          level: "error",
          module: entry.manifest.id,
          message: `"${entry.manifest.id}" needs the native stack, but ${fallback} ${verb} back to the stack templates`,
        });
      }
    }
  } else {
    for (const manifest of catalog.values()) {
      if (!manifest.hidden || reasons.has(manifest.id)) continue;
      if (supportGaps(manifest.supports, stack, manifest.id).length) continue;
      reasons.set(manifest.id, { kind: "foundation" });
      queue.push(manifest.id);
    }
    drain();
  }

  for (const id of reasons.keys()) {
    for (const other of catalog.get(id)!.conflicts ?? []) {
      if (reasons.has(other) && id < other) {
        issues.push({ level: "error", module: id, message: `"${id}" conflicts with "${other}"` });
      }
    }
  }

  const ordered = topoSort([...reasons.keys()], entries, issues);
  const domains: ResolvedPlan["domains"] = {};

  const modules: ResolvedModule[] = ordered.map((id) => {
    const { manifest, variant, providers, options } = entries.get(id)!;
    if (manifest.domain) {
      domains[manifest.domain.field] = manifest.domain.value({ providers, options });
    }
    const integrations =
      variant === "native"
        ? (manifest.enhances ?? []).filter((other) => entries.get(other)?.variant === "native")
        : [];
    return { manifest, variant, providers, options, reason: reasons.get(id)!, integrations };
  });

  for (const key of Object.keys(selection.providers)) {
    if (!reasons.has(key)) {
      issues.push({
        level: "warning",
        module: key,
        message: `Providers given for "${key}" but the module is not included`,
      });
    }
  }

  return { plan: { modules, issues, notes, domains }, entries };
}

function resolveEntry(
  manifest: ModuleManifest,
  selection: ModuleSelection,
  stack: StackContext,
  forceStack: boolean,
  issues: ResolveIssue[],
  notes: string[],
): Entry {
  const id = manifest.id;
  const requested = selection.providers[id];
  const options = resolveOptions(manifest, selection.options[id] ?? {}, issues);
  const candidates = pickProviders(manifest, requested, issues);
  const input = { providers: candidates, options };

  const nativeGaps = forceStack
    ? []
    : [
        ...supportGaps(manifest.supports, stack, `Module "${id}"`),
        ...candidates.flatMap((provider) =>
          supportGaps(
            manifest.providers?.options[provider]?.supports,
            stack,
            `Provider "${id}.${provider}"`,
          ),
        ),
      ];
  const nativeFits = manifest.domain?.native?.(input) ?? true;
  const fallback = manifest.domain?.stack;

  if (!forceStack && !nativeGaps.length && nativeFits) {
    checkProviderCount(manifest, candidates, issues);
    if (requested === undefined && candidates.length) {
      notes.push(`Using default providers for "${id}": ${candidates.join(", ")}`);
    }
    return {
      manifest,
      variant: "native",
      providers: candidates,
      options,
      requires: manifest.requires ?? [],
    };
  }

  if (!fallback) {
    for (const message of nativeGaps) issues.push({ level: "error", module: id, message });
    if (!nativeGaps.length) {
      issues.push({ level: "error", module: id, message: `Unsupported configuration for "${id}"` });
    }
    return {
      manifest,
      variant: "native",
      providers: candidates,
      options,
      requires: manifest.requires ?? [],
    };
  }

  for (const message of supportGaps(fallback.supports, stack, `Module "${id}"`)) {
    issues.push({ level: "error", module: id, message });
  }
  const allowed = fallback.providers ?? [];
  const providers = candidates.filter((provider) => allowed.includes(provider));
  if (requested !== undefined) {
    for (const provider of candidates.filter((p) => !allowed.includes(p))) {
      issues.push({
        level: "error",
        module: id,
        message: `Provider "${id}.${provider}" is not available with the stack templates${allowed.length ? ` (available: ${allowed.join(", ")})` : ""}`,
      });
    }
  }
  checkProviderCount(manifest, providers, issues);
  notes.push(
    `"${id}" uses the stack templates${nativeGaps[0] ? `: ${nativeGaps[0]}` : forceStack ? " because a dependent module does" : ""}`,
  );
  return { manifest, variant: "stack", providers, options, requires: fallback.requires ?? [] };
}

function pickProviders(
  manifest: ModuleManifest,
  requested: string[] | undefined,
  issues: ResolveIssue[],
): string[] {
  const spec = manifest.providers;
  if (!spec) {
    if (requested?.length) {
      issues.push({
        level: "error",
        module: manifest.id,
        message: `Module "${manifest.id}" has no providers`,
      });
    }
    return [];
  }

  const providers = requested ? [...new Set(requested)] : [...(spec.default?.global ?? [])];
  for (const id of providers) {
    if (!spec.options[id]) {
      issues.push({
        level: "error",
        module: manifest.id,
        message: `Unknown provider "${id}" for "${manifest.id}" (available: ${Object.keys(spec.options).join(", ")})`,
      });
    }
  }
  return providers.filter((id) => id in spec.options);
}

function checkProviderCount(manifest: ModuleManifest, providers: string[], issues: ResolveIssue[]) {
  const spec = manifest.providers;
  if (!spec) return;
  const min = spec.min ?? 0;
  if (providers.length < min) {
    issues.push({
      level: "error",
      module: manifest.id,
      message: `"${manifest.id}" needs at least ${min} provider(s)`,
    });
  }
  if (spec.max !== undefined && providers.length > spec.max) {
    issues.push({
      level: "error",
      module: manifest.id,
      message: `"${manifest.id}" accepts at most ${spec.max} provider(s)`,
    });
  }
}

function resolveOptions(
  manifest: ModuleManifest,
  requested: ModuleOptionValues,
  issues: ResolveIssue[],
): ModuleOptionValues {
  const result: ModuleOptionValues = {};
  const specs = manifest.options ?? {};

  for (const key of Object.keys(requested)) {
    if (!(key in specs)) {
      issues.push({
        level: "error",
        module: manifest.id,
        message: `Unknown option "${key}" for "${manifest.id}"`,
      });
    }
  }

  for (const [key, spec] of Object.entries(specs)) {
    let value = requested[key] ?? spec.default;
    if (spec.type === "number") {
      value = Number(value);
      if (!Number.isFinite(value) || (spec.min !== undefined && value < spec.min)) {
        issues.push({
          level: "error",
          module: manifest.id,
          message: `Option "${manifest.id}.${key}" must be a number${spec.min === undefined ? "" : ` >= ${spec.min}`}`,
        });
      }
    }
    if (spec.type === "enum" && !spec.values.includes(String(value))) {
      issues.push({
        level: "error",
        module: manifest.id,
        message: `Option "${manifest.id}.${key}" must be one of: ${spec.values.join(", ")}`,
      });
    }
    if (spec.type === "boolean" && value !== true && value !== false) {
      issues.push({
        level: "error",
        module: manifest.id,
        message: `Option "${manifest.id}.${key}" must be a boolean`,
      });
    }
    result[key] = value;
  }

  return result;
}

function topoSort(
  ids: string[],
  entries: ReadonlyMap<string, Entry>,
  issues: ResolveIssue[],
): string[] {
  const present = new Set(ids);
  const state = new Map<string, "visiting" | "done">();
  const result: string[] = [];

  const visit = (id: string, path: string[]) => {
    const current = state.get(id);
    if (current === "done") return;
    if (current === "visiting") {
      issues.push({
        level: "error",
        module: id,
        message: `Circular module dependency: ${[...path, id].join(" -> ")}`,
      });
      return;
    }
    state.set(id, "visiting");
    for (const dep of entries.get(id)?.requires ?? []) {
      if (present.has(dep)) visit(dep, [...path, id]);
    }
    state.set(id, "done");
    result.push(id);
  };

  for (const id of [...ids].sort()) visit(id, []);
  return result;
}

export function hasErrors(plan: ResolvedPlan): boolean {
  return plan.issues.some((issue) => issue.level === "error");
}
