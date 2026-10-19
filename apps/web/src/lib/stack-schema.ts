import { ProjectConfigSchema } from "@xstack/types";
import { z } from "zod";

import { DEFAULT_STACK, TECH_OPTIONS, getStackOptionIds, type StackState } from "./constant";
import { getStackBackend, getStackFrontends } from "./stack-model";
import { formatProjectName } from "./stack-utils";

const option = <K extends keyof typeof TECH_OPTIONS>(category: K) =>
  z.enum(getStackOptionIds(category));

export const StackProvidersSchema = z.record(z.string(), z.array(z.string()));
export const StackModuleOptionsSchema = z.record(
  z.string(),
  z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
);

const stackFields = {
  projectName: z.string().nullable(),
  webFrontend: z.array(option("webFrontend")),
  nativeFrontend: z.array(option("nativeFrontend")),
  runtime: option("runtime"),
  backend: option("backend"),
  database: option("database"),
  orm: option("orm"),
  dbSetup: option("dbSetup"),
  packageManager: option("packageManager"),
  addons: z.array(z.enum(["none", ...getStackOptionIds("addons")])),
  features: z.array(z.enum(["none", ...getStackOptionIds("features")])),
  providers: StackProvidersSchema,
  moduleOptions: StackModuleOptionsSchema,
  git: option("git"),
  install: option("install"),
  api: option("api"),
  webDeploy: option("webDeploy"),
  serverDeploy: option("serverDeploy"),
  yolo: z.enum(["true", "false"]),
};

export const StackUpdateSchema = z.object(stackFields).partial();

export const StackStateSchema = z.object({
  projectName: stackFields.projectName.default(DEFAULT_STACK.projectName),
  webFrontend: stackFields.webFrontend.default(DEFAULT_STACK.webFrontend),
  nativeFrontend: stackFields.nativeFrontend.default(DEFAULT_STACK.nativeFrontend),
  runtime: stackFields.runtime.default(DEFAULT_STACK.runtime),
  backend: stackFields.backend.default(DEFAULT_STACK.backend),
  database: stackFields.database.default(DEFAULT_STACK.database),
  orm: stackFields.orm.default(DEFAULT_STACK.orm),
  dbSetup: stackFields.dbSetup.default(DEFAULT_STACK.dbSetup),
  packageManager: stackFields.packageManager.default(DEFAULT_STACK.packageManager),
  addons: stackFields.addons.default(DEFAULT_STACK.addons),
  features: stackFields.features.default(DEFAULT_STACK.features),
  providers: stackFields.providers.default(DEFAULT_STACK.providers),
  moduleOptions: stackFields.moduleOptions.default(DEFAULT_STACK.moduleOptions),
  git: stackFields.git.default(DEFAULT_STACK.git),
  install: stackFields.install.default(DEFAULT_STACK.install),
  api: stackFields.api.default(DEFAULT_STACK.api),
  webDeploy: stackFields.webDeploy.default(DEFAULT_STACK.webDeploy),
  serverDeploy: stackFields.serverDeploy.default(DEFAULT_STACK.serverDeploy),
  yolo: stackFields.yolo.default(DEFAULT_STACK.yolo),
});

export function stackStateToConfig(stack: StackState) {
  const projectPath = formatProjectName(stack.projectName);
  const projectName = projectPath.split(/[\\/]/).filter(Boolean).at(-1) || "my-xstack-app";
  return ProjectConfigSchema.parse({
    ...stack,
    projectName: projectName === "." ? "my-xstack-app" : projectName,
    projectDir: "/virtual",
    relativePath: "./virtual",
    frontend: getStackFrontends(stack),
    backend: getStackBackend(stack.backend),
    addons: stack.addons.filter((id) => id !== "none"),
    product: {
      features: stack.features.filter((id) => id !== "none"),
      providers: stack.providers,
      options: stack.moduleOptions,
    },
    git: stack.git === "true",
    install: false,
  });
}
