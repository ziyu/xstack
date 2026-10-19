import {
  createLoader,
  createSerializer,
  parseAsArrayOf as parseAsArrayOfServer,
  parseAsJson,
  parseAsStringEnum as parseAsStringEnumServer,
  parseAsString as parseAsStringServer,
  type UrlKeys,
} from "nuqs/server";

import { DEFAULT_STACK, type StackState, getStackOptionIds } from "@/lib/constant";
import { resolveStackCompatibility } from "@/lib/stack-compatibility";
import { stackUrlKeys } from "@/lib/stack-url-keys";

import { sanitizeStackState } from "./sanitize-stack-addons";
import { StackModuleOptionsSchema, StackProvidersSchema } from "./stack-schema";

const serverStackParsers = {
  projectName: parseAsStringServer.withDefault(DEFAULT_STACK.projectName || "my-xstack-app"),
  webFrontend: parseAsArrayOfServer(parseAsStringServer).withDefault(DEFAULT_STACK.webFrontend),
  nativeFrontend: parseAsArrayOfServer(parseAsStringServer).withDefault(
    DEFAULT_STACK.nativeFrontend,
  ),
  runtime: parseAsStringEnumServer<StackState["runtime"]>(getStackOptionIds("runtime")).withDefault(
    DEFAULT_STACK.runtime,
  ),
  backend: parseAsStringEnumServer<StackState["backend"]>(getStackOptionIds("backend")).withDefault(
    DEFAULT_STACK.backend,
  ),
  api: parseAsStringEnumServer<StackState["api"]>(getStackOptionIds("api")).withDefault(
    DEFAULT_STACK.api,
  ),
  database: parseAsStringEnumServer<StackState["database"]>(
    getStackOptionIds("database"),
  ).withDefault(DEFAULT_STACK.database),
  orm: parseAsStringEnumServer<StackState["orm"]>(getStackOptionIds("orm")).withDefault(
    DEFAULT_STACK.orm,
  ),
  dbSetup: parseAsStringEnumServer<StackState["dbSetup"]>(getStackOptionIds("dbSetup")).withDefault(
    DEFAULT_STACK.dbSetup,
  ),
  packageManager: parseAsStringEnumServer<StackState["packageManager"]>(
    getStackOptionIds("packageManager"),
  ).withDefault(DEFAULT_STACK.packageManager),
  addons: parseAsArrayOfServer(parseAsStringServer).withDefault(DEFAULT_STACK.addons),
  features: parseAsArrayOfServer(parseAsStringServer).withDefault(DEFAULT_STACK.features),
  providers: parseAsJson(StackProvidersSchema.parse).withDefault(DEFAULT_STACK.providers),
  moduleOptions: parseAsJson(StackModuleOptionsSchema.parse).withDefault(
    DEFAULT_STACK.moduleOptions,
  ),
  git: parseAsStringEnumServer<StackState["git"]>(["true", "false"]).withDefault(DEFAULT_STACK.git),
  install: parseAsStringEnumServer<StackState["install"]>(["true", "false"]).withDefault(
    DEFAULT_STACK.install,
  ),
  webDeploy: parseAsStringEnumServer<StackState["webDeploy"]>(
    getStackOptionIds("webDeploy"),
  ).withDefault(DEFAULT_STACK.webDeploy),
  serverDeploy: parseAsStringEnumServer<StackState["serverDeploy"]>(
    getStackOptionIds("serverDeploy"),
  ).withDefault(DEFAULT_STACK.serverDeploy),
  yolo: parseAsStringEnumServer<StackState["yolo"]>(["true", "false"]).withDefault(
    DEFAULT_STACK.yolo,
  ),
};

const rawLoadStackParams = createLoader(serverStackParsers, {
  urlKeys: stackUrlKeys as UrlKeys<typeof serverStackParsers>,
});

export const serializeStackParams = createSerializer(serverStackParsers, {
  urlKeys: stackUrlKeys as UrlKeys<typeof serverStackParsers>,
});

export async function loadStackParams(
  searchParams: Parameters<typeof rawLoadStackParams>[0],
): Promise<StackState> {
  const stackState = await rawLoadStackParams(searchParams);
  return resolveStackCompatibility(sanitizeStackState(stackState)).stack;
}

export type LoadedStackState = Awaited<ReturnType<typeof loadStackParams>>;
