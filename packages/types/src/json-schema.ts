import { z } from "zod";

import {
  DatabaseSchema,
  ORMSchema,
  BackendSchema,
  RuntimeSchema,
  FrontendSchema,
  AddonsSchema,
  PackageManagerSchema,
  DatabaseSetupSchema,
  APISchema,
  WebDeploySchema,
  ServerDeploySchema,
  DirectoryConflictSchema,
  TemplateSchema,
  AddonOptionsSchema,
  DbSetupOptionsSchema,
  CreateInputSchema,
  AddInputSchema,
  ProjectConfigSchema,
  XStackConfigSchema,
  XStackConfigFileSchema,
  InitResultSchema,
} from "./schemas";

// Generate JSON schemas for each type
export function getDatabaseJsonSchema() {
  return z.toJSONSchema(DatabaseSchema);
}

export function getORMJsonSchema() {
  return z.toJSONSchema(ORMSchema);
}

export function getBackendJsonSchema() {
  return z.toJSONSchema(BackendSchema);
}

export function getRuntimeJsonSchema() {
  return z.toJSONSchema(RuntimeSchema);
}

export function getFrontendJsonSchema() {
  return z.toJSONSchema(FrontendSchema);
}

export function getAddonsJsonSchema() {
  return z.toJSONSchema(AddonsSchema);
}

export function getPackageManagerJsonSchema() {
  return z.toJSONSchema(PackageManagerSchema);
}

export function getDatabaseSetupJsonSchema() {
  return z.toJSONSchema(DatabaseSetupSchema);
}

export function getAPIJsonSchema() {
  return z.toJSONSchema(APISchema);
}

export function getWebDeployJsonSchema() {
  return z.toJSONSchema(WebDeploySchema);
}

export function getServerDeployJsonSchema() {
  return z.toJSONSchema(ServerDeploySchema);
}

export function getDirectoryConflictJsonSchema() {
  return z.toJSONSchema(DirectoryConflictSchema);
}

export function getTemplateJsonSchema() {
  return z.toJSONSchema(TemplateSchema);
}

export function getAddonOptionsJsonSchema() {
  return z.toJSONSchema(AddonOptionsSchema);
}

export function getDbSetupOptionsJsonSchema() {
  return z.toJSONSchema(DbSetupOptionsSchema);
}

export function getCreateInputJsonSchema() {
  return z.toJSONSchema(CreateInputSchema);
}

export function getAddInputJsonSchema() {
  return z.toJSONSchema(AddInputSchema);
}

export function getProjectConfigJsonSchema() {
  return z.toJSONSchema(ProjectConfigSchema);
}

export function getXStackConfigJsonSchema() {
  return z.toJSONSchema(XStackConfigSchema);
}

export function getXStackConfigFileJsonSchema() {
  return z.toJSONSchema(XStackConfigFileSchema, { target: "draft-7" });
}

export function getInitResultJsonSchema() {
  return z.toJSONSchema(InitResultSchema);
}

// Get all JSON schemas as a single object
export function getAllJsonSchemas() {
  return {
    database: getDatabaseJsonSchema(),
    orm: getORMJsonSchema(),
    backend: getBackendJsonSchema(),
    runtime: getRuntimeJsonSchema(),
    frontend: getFrontendJsonSchema(),
    addons: getAddonsJsonSchema(),
    packageManager: getPackageManagerJsonSchema(),
    databaseSetup: getDatabaseSetupJsonSchema(),
    api: getAPIJsonSchema(),
    webDeploy: getWebDeployJsonSchema(),
    serverDeploy: getServerDeployJsonSchema(),
    directoryConflict: getDirectoryConflictJsonSchema(),
    template: getTemplateJsonSchema(),
    addonOptions: getAddonOptionsJsonSchema(),
    dbSetupOptions: getDbSetupOptionsJsonSchema(),
    createInput: getCreateInputJsonSchema(),
    addInput: getAddInputJsonSchema(),
    projectConfig: getProjectConfigJsonSchema(),
    xstackConfig: getXStackConfigJsonSchema(),
    xstackConfigFile: getXStackConfigFileJsonSchema(),
    initResult: getInitResultJsonSchema(),
  };
}
