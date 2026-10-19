import {
  supportsClerkFrontend,
  supportsClerkBackend,
  isFrontendAllowedWithBackend,
} from "@xstack/types";

import type { Auth, Backend, Frontend } from "../types";
import { supportsConvexBetterAuth } from "../utils/compatibility-rules";

export function getAvailableAuthProviders(
  backend?: Backend,
  frontend: readonly Frontend[] = [],
): Auth[] {
  if (backend === "none") {
    return ["none"];
  }

  const options: Auth[] = [];

  if (backend === "convex") {
    if (
      supportsConvexBetterAuth(frontend) &&
      frontend.every((f) => isFrontendAllowedWithBackend(f, backend, "better-auth"))
    ) {
      options.push("better-auth");
    }
  } else {
    options.push("better-auth");
  }

  if (supportsClerkFrontend(frontend) && supportsClerkBackend(backend, frontend)) {
    options.push("clerk");
  }

  if (options.length === 0) {
    return ["none"];
  }

  return [...options, "none"];
}
