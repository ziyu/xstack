import type { ApplicationAdapter } from "@xstack/types";

/** Undeclared controls are fixed at the adapter default, not inferred from framework names. */
export function applicationOptions(adapter: ApplicationAdapter) {
  return (
    adapter.options ?? {
      runtime: { values: [adapter.stack.runtime ?? "none"], visibility: "hidden" as const },
      api: { values: [adapter.stack.api ?? "none"], visibility: "hidden" as const },
    }
  );
}

/** Catalog declarations are not generated application files. */
export function isApplicationMetadataPath(path: string): boolean {
  return /(?:^|\/)(?:app|adapter)\.json$/.test(path);
}
