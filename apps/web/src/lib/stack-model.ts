import { APPLICATION_TEMPLATES, readFrameworkCatalog } from "@xstack/template-generator/apps";
import type { Backend, Frontend, FullstackFrontend } from "@xstack/types";

import type { StackState } from "./constant";

const fullstackFrontends = [...readFrameworkCatalog(APPLICATION_TEMPLATES).values()]
  .flatMap((framework) => Object.values(framework.apps))
  .filter((adapter) => adapter.stack.backend === "self")
  .flatMap((adapter) => adapter.stack.frontend ?? []);

export function getSelfBackendFrontend(backend: StackState["backend"]) {
  return fullstackFrontends.find((frontend) => backend === `self-${frontend}`) as
    | FullstackFrontend
    | undefined;
}

export function isSelfHostedFullstackBackend(
  backend: StackState["backend"],
): backend is Extract<StackState["backend"], `self-${string}`> {
  return getSelfBackendFrontend(backend) !== undefined;
}

export function getStackBackend(backend: StackState["backend"]): Backend {
  return isSelfHostedFullstackBackend(backend) ? "self" : backend;
}

export function getStackFrontends(
  stack: Pick<StackState, "webFrontend" | "nativeFrontend">,
): Frontend[] {
  const frontends = [...stack.webFrontend, ...stack.nativeFrontend].filter((id) => id !== "none");
  return frontends.length ? frontends : ["none"];
}
