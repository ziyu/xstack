import type { Support } from "../types";

/** Full-stack frameworks with native product modules and no separate API layer. */
export const NATIVE_SHELL = {
  frameworks: ["next", "tanstack-start", "nuxt"],
  backends: ["self"],
  apis: ["none"],
} satisfies Support;

export const NATIVE_SHELL_DB = {
  ...NATIVE_SHELL,
  orms: ["drizzle"],
  dialects: ["sqlite", "postgres"],
} satisfies Support;
