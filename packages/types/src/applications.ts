import { z } from "zod";

export const ApplicationIdSchema = z
  .string()
  .max(214)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Expected a lowercase kebab-case identifier")
  .refine(
    (id) => !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(id),
    "Identifier is a reserved directory name",
  );

export const ApplicationRoleSchema = z.string().min(1);

export const ApplicationSelectionStackSchema = z.strictObject({
  framework: ApplicationIdSchema.optional(),
  runtime: z.enum(["node", "bun", "workers", "none"]).optional(),
  api: z.enum(["orpc", "trpc", "none"]).optional(),
});

export const ApplicationSelectionSchema = z.strictObject({
  id: ApplicationIdSchema.describe("Application instance name and output directory"),
  type: ApplicationIdSchema.describe("Stable application type"),
  stack: ApplicationSelectionStackSchema.describe(
    "Framework and runtime choices for the application",
  ),
  product: ApplicationIdSchema.optional().describe(
    "Product group; defaults to main for product apps",
  ),
  bindings: z
    .record(ApplicationRoleSchema, ApplicationIdSchema)
    .optional()
    .describe("Required role to application instance ID bindings"),
});
