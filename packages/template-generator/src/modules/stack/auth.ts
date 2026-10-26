import {
  acceptsStackRoles,
  renderStackContributions,
  stackClientContributions,
  WEB_CLIENT_ROLES,
  type StackContribution,
} from "../../contributions/stack";
import type { VirtualFileSystem } from "../../core/virtual-fs";
import type { TemplateData } from "../../template-handlers/utils";
import type { RenderConfig } from "../../types";
import { getBackendConsumerFrontends } from "../../utils/add-deps";

const STACK = "modules/auth/stack";

/** Adapter declarations select implementations; roles select application ownership. */
export function planAuthContributions(config: RenderConfig): StackContribution[] {
  if (!config.auth || config.auth === "none") return [];

  const provider = config.auth;
  const root = `${STACK}/${provider}`;
  const owner = `auth:${provider}`;
  const plan: StackContribution[] = [];
  const target = config.application?.directory ?? "apps/web";
  const ownsBackend = config.backend !== "none" && acceptsStackRoles(config, ["backend"]);
  function add(
    source: string,
    destination: string,
    roles?: readonly string[],
    kind: StackContribution["kind"] = "prefix",
  ) {
    plan.push({ source, target: destination, owner, roles, kind, required: true });
  }

  if (config.backend === "convex") {
    const convex = `${root}/convex`;
    add(`${convex}/backend`, "packages/backend");
    for (const { framework, family } of stackClientContributions(config)) {
      if (family === "native") {
        const nativeTarget = config.application?.directory ?? "apps/native";
        add(`${convex}/apps/native/base`, nativeTarget);
        if (provider !== "clerk") add(`${convex}/apps/native/${framework}`, nativeTarget);
      } else if (acceptsStackRoles(config, WEB_CLIENT_ROLES)) {
        const frameworkPath = family === "react" ? `react/${framework}` : framework;
        add(`${convex}/shared/client/frameworks/${frameworkPath}`, target, WEB_CLIENT_ROLES);
      }
    }
    return plan;
  }

  // Hosted Clerk authentication has no local auth service or identity schema.
  if (config.backend !== "none" && provider !== "clerk") {
    add(`${root}/server/base`, "packages/auth");
    if (config.orm !== "none" && config.database !== "none") {
      add(`${root}/server/db/${config.orm}/${config.database}`, "packages/db");
    }
  }

  for (const { framework, family } of stackClientContributions(config)) {
    if (family === "native") {
      const nativeTarget = config.application?.directory ?? "apps/native";
      add(`${root}/apps/native/base`, nativeTarget);
      if (provider !== "clerk") add(`${root}/apps/native/${framework}`, nativeTarget);
      continue;
    }
    if (!acceptsStackRoles(config, WEB_CLIENT_ROLES)) continue;
    if (family === "react") {
      add(`${root}/shared/client/frameworks/react/base`, target, WEB_CLIENT_ROLES);
      add(`${root}/shared/client/frameworks/react/${framework}`, target, WEB_CLIENT_ROLES);
    } else {
      add(`${root}/shared/client/frameworks/${framework}`, target, WEB_CLIENT_ROLES);
    }
    if (ownsBackend && config.backend === "self" && provider !== "clerk") {
      add(`${root}/apps/fullstack-web/frameworks/${framework}`, target, ["backend"]);
    }
    if (framework === "solid" && provider === "better-auth") {
      add(`${root}/client/auth-client.ts.hbs`, `${target}/src/client.ts`, WEB_CLIENT_ROLES, "file");
    }
    if (framework === "svelte" && provider === "better-auth") {
      const serverLoader =
        config.backend === "self" ||
        (config.webDeploy === config.serverDeploy &&
          ["vercel", "docker"].includes(config.webDeploy));
      add(
        `${root}/loaders/svelte/dashboard.ts.hbs`,
        `${target}/src/routes/dashboard/+page${serverLoader ? ".server" : ""}.ts`,
        WEB_CLIENT_ROLES,
        "file",
      );
    }
  }
  return plan;
}

export async function processAuthTemplates(
  vfs: VirtualFileSystem,
  templates: TemplateData,
  config: RenderConfig,
): Promise<void> {
  const contributions = planAuthContributions(config);
  const shared = contributions.filter((contribution) =>
    contribution.target.startsWith("packages/"),
  );
  const clients = contributions.filter(
    (contribution) => !contribution.target.startsWith("packages/"),
  );
  renderStackContributions(
    vfs,
    templates,
    {
      ...config,
      frontend: getBackendConsumerFrontends(config),
    },
    shared,
  );
  renderStackContributions(vfs, templates, config, clients);
}
