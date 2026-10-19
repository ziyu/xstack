import type { Support } from "../types";

/** Stack the product shell renders on: Next.js serving its own routes, no API layer. */
export const NEXT_SHELL = {
  frameworks: ["next"],
  backends: ["self"],
  apis: ["none"],
} satisfies Support;

export const NEXT_SHELL_DB = {
  ...NEXT_SHELL,
  orms: ["drizzle"],
  dialects: ["sqlite", "postgres"],
} satisfies Support;
