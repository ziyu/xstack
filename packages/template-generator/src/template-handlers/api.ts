import {
  acceptsStackRoles,
  renderStackContributions,
  stackClientContributions,
  WEB_CLIENT_ROLES,
  type StackContribution,
} from "../contributions/stack";
import type { VirtualFileSystem } from "../core/virtual-fs";
import type { RenderConfig } from "../types";
import type { TemplateData } from "./utils";

/** Select declared client families and backend roles, never application names. */
export function planApiContributions(config: RenderConfig): StackContribution[] {
  if (config.api === "none" || config.backend === "convex") return [];

  const root = `api/${config.api}`;
  const owner = `api:${config.api}`;
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

  add(`${root}/server`, "packages/api");
  if (ownsBackend) {
    const server =
      config.application?.directory ?? (config.backend === "self" ? target : "apps/server");
    add(`${root}/context.ts.hbs`, `${server}/src/context.ts`, ["backend"], "file");
  }

  for (const { framework, family } of stackClientContributions(config)) {
    if (family === "native") {
      add(`${root}/apps/native`, config.application?.directory ?? "apps/native");
      continue;
    }
    if (!acceptsStackRoles(config, WEB_CLIENT_ROLES)) continue;
    if (family === "react") {
      add(`${root}/shared/client/frameworks/react/base`, target, WEB_CLIENT_ROLES);
      if (ownsBackend && config.backend === "self") {
        add(`${root}/apps/fullstack-web/frameworks/${framework}`, target, ["backend"]);
      }
      continue;
    }
    if (framework === "nuxt" && ownsBackend && config.backend === "self") {
      add(`${root}/apps/fullstack-web/frameworks/${framework}`, target, ["backend"]);
      add(
        `${root}/shared/client/frameworks/nuxt/app/plugins/vue-query.ts.hbs`,
        `${target}/app/plugins/vue-query.ts`,
        WEB_CLIENT_ROLES,
        "file",
      );
      continue;
    }
    add(`${root}/shared/client/frameworks/${framework}`, target, WEB_CLIENT_ROLES);
    if (ownsBackend && config.backend === "self") {
      add(`${root}/apps/fullstack-web/frameworks/${framework}`, target, ["backend"]);
      if (framework === "svelte" && config.auth !== "better-auth") {
        add(
          `${root}/shared/server/svelte/hooks.server.ts.hbs`,
          `${target}/src/hooks.server.ts`,
          ["backend"],
          "file",
        );
      }
    } else if (framework === "svelte") {
      add(
        `${root}/shared/server/svelte/orpc.remote.server.ts.hbs`,
        `${target}/src/lib/orpc.server.ts`,
        WEB_CLIENT_ROLES,
        "file",
      );
      add(
        `${root}/shared/server/svelte/hooks.server.ts.hbs`,
        `${target}/src/hooks.server.ts`,
        WEB_CLIENT_ROLES,
        "file",
      );
    }
  }
  return plan;
}

export async function processApiTemplates(
  vfs: VirtualFileSystem,
  templates: TemplateData,
  config: RenderConfig,
): Promise<void> {
  renderStackContributions(vfs, templates, config, planApiContributions(config));
}
