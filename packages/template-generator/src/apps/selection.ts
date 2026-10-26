import type { ApplicationSelection, ApplicationStack } from "@xstack/types";

import {
  readApplicationCatalog,
  readFrameworkCatalog,
  resolveApplications,
  type ApplicationIssue,
} from "./plan";

export interface LegacyApplicationConversion {
  apps: ApplicationSelection[];
  issues: ApplicationIssue[];
}

/** Convert only an unambiguous exact cover of the legacy stack's implementations. */
export function convertLegacyApplications(
  stack: ApplicationStack,
  templates: Map<string, string>,
): LegacyApplicationConversion {
  const manifests = readApplicationCatalog(templates);
  const frameworks = readFrameworkCatalog(templates);
  const selected = new Set<string>(
    (stack.frontend ?? []).filter((id) => id !== "none").map((id) => `frontend:${id}`),
  );
  if (stack.backend && stack.backend !== "none") selected.add(`backend:${stack.backend}`);
  const candidates = [...frameworks.values()].flatMap((framework) =>
    Object.entries(framework.apps).flatMap(([type, adapter]) => {
      const manifest = manifests.get(type);
      if (!manifest || !adapter.legacy) return [];
      const covers = (adapter.stack.frontend ?? [])
        .filter((id) => id !== "none")
        .map((id) => `frontend:${id}`);
      if (adapter.stack.backend && adapter.stack.backend !== "none")
        covers.push(`backend:${adapter.stack.backend}`);
      if (!covers.length || covers.some((key) => !selected.has(key))) return [];
      return [{ framework: framework.id, type, manifest, covers }];
    }),
  );
  const solutions: (typeof candidates)[] = [];
  function cover(remaining: Set<string>, chosen: typeof candidates): void {
    if (solutions.length > 1) return;
    const first = remaining.values().next().value;
    if (first === undefined) {
      solutions.push(chosen);
      return;
    }
    for (const candidate of candidates) {
      if (!candidate.covers.includes(first) || candidate.covers.some((key) => !remaining.has(key)))
        continue;
      const next = new Set(remaining);
      for (const key of candidate.covers) next.delete(key);
      cover(next, [...chosen, candidate]);
    }
  }
  cover(selected, []);
  if (solutions.length !== 1 || !solutions[0]!.length)
    return {
      apps: [],
      issues: [
        {
          code: solutions.length > 1 ? "ambiguous-legacy-mapping" : "unsupported-legacy-mapping",
          message:
            solutions.length > 1
              ? `Multiple application adapters map to ${[...selected].join(", ")}. Choose applications explicitly or keep only one legacy-enabled mapping.`
              : `No complete application mapping for ${[...selected].join(", ") || "the empty stack"}. Declare a legacy-enabled adapter for every selected implementation before converting.`,
        },
      ],
    };
  const apps: ApplicationSelection[] = [];
  for (const candidate of solutions[0]!) {
    let id = candidate.manifest.defaultDirectoryName;
    let suffix = 2;
    while (apps.some((app) => app.id === id))
      id = `${candidate.manifest.defaultDirectoryName}-${suffix++}`;
    const selection: ApplicationSelection = {
      id,
      type: candidate.type,
      stack: { framework: candidate.framework },
    };
    if (candidate.manifest.roles.includes("backend")) {
      selection.stack.runtime = stack.runtime;
      selection.stack.api = stack.api;
    }
    apps.push(selection);
  }
  if (
    !solutions[0]!.some((candidate) => candidate.manifest.roles.includes("backend")) &&
    ((stack.runtime !== undefined && stack.runtime !== "none") ||
      (stack.api !== undefined && stack.api !== "none"))
  ) {
    return {
      apps,
      issues: [
        {
          code: "unsupported-legacy-mapping",
          message: `Runtime ${stack.runtime ?? "none"} and API ${stack.api ?? "none"} have no backend role owner. Keep the legacy layout or select an application that owns these settings.`,
        },
      ],
    };
  }
  return { apps, issues: resolveApplications(apps, templates).issues };
}
