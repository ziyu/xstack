import type { z } from "zod";

import type {
  ApplicationIdSchema,
  ApplicationRoleSchema,
  ApplicationSelectionSchema,
  ApplicationSelectionStackSchema,
} from "./applications";
import type {
  DatabaseSchema,
  ORMSchema,
  BackendSchema,
  RuntimeSchema,
  FrontendSchema,
  AddonsSchema,
  PackageManagerSchema,
  DatabaseSetupSchema,
  APISchema,
  AuthSchema,
  WebDeploySchema,
  ServerDeploySchema,
  DirectoryConflictSchema,
  TemplateSchema,
  AddonOptionsSchema,
  DbSetupOptionsSchema,
  ProjectNameSchema,
  CreateInputSchema,
  AddInputSchema,
  CLIInputSchema,
  ProjectConfigSchema,
  XStackConfigSchema,
  InitResultSchema,
  ProductConfigSchema,
  ProductPresetSchema,
  ApplicationManifestSchema,
  ApplicationStackSchema,
  ApplicationAdapterSchema,
  FrameworkAdapterSchema,
} from "./schemas";

// Inferred types from Zod schemas
export type Database = z.infer<typeof DatabaseSchema>;
export type ORM = z.infer<typeof ORMSchema>;
export type Backend = z.infer<typeof BackendSchema>;
export type Runtime = z.infer<typeof RuntimeSchema>;
export type Frontend = z.infer<typeof FrontendSchema>;
export type Addons = z.infer<typeof AddonsSchema>;
export type PackageManager = z.infer<typeof PackageManagerSchema>;
export type DatabaseSetup = z.infer<typeof DatabaseSetupSchema>;
export type API = z.infer<typeof APISchema>;
export type Auth = z.infer<typeof AuthSchema>;
export type WebDeploy = z.infer<typeof WebDeploySchema>;
export type ServerDeploy = z.infer<typeof ServerDeploySchema>;
export type DirectoryConflict = z.infer<typeof DirectoryConflictSchema>;
export type Template = z.infer<typeof TemplateSchema>;
export type AddonOptions = z.infer<typeof AddonOptionsSchema>;
export type DbSetupOptions = z.infer<typeof DbSetupOptionsSchema>;
export type ProjectName = z.infer<typeof ProjectNameSchema>;

export type CreateInput = z.infer<typeof CreateInputSchema>;
export type AddInput = z.infer<typeof AddInputSchema>;
export type CLIInput = z.infer<typeof CLIInputSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type XStackConfig = z.infer<typeof XStackConfigSchema>;
export type InitResult = z.infer<typeof InitResultSchema>;
export type ProductConfig = z.infer<typeof ProductConfigSchema>;
export type ProductPreset = z.infer<typeof ProductPresetSchema>;
export type ApplicationId = z.infer<typeof ApplicationIdSchema>;
export type ApplicationRole = z.infer<typeof ApplicationRoleSchema>;
export type ApplicationSelection = z.infer<typeof ApplicationSelectionSchema>;
export type ApplicationStack = z.infer<typeof ApplicationStackSchema>;
export type ApplicationManifest = z.infer<typeof ApplicationManifestSchema>;
export type ApplicationSelectionStack = z.infer<typeof ApplicationSelectionStackSchema>;
export type ApplicationAdapter = z.infer<typeof ApplicationAdapterSchema>;
export type FrameworkAdapter = z.infer<typeof FrameworkAdapterSchema>;

export type WebFrontend = Extract<
  Frontend,
  | "tanstack-router"
  | "react-router"
  | "tanstack-start"
  | "next"
  | "nuxt"
  | "svelte"
  | "solid"
  | "astro"
  | "none"
>;

export type DesktopWebFrontend = Exclude<WebFrontend, "none" | "solid">;

export type NativeFrontend = Extract<
  Frontend,
  "native-bare" | "native-uniwind" | "native-unistyles" | "none"
>;
