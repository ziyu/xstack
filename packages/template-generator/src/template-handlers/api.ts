import {
  acceptsStackApplication,
  renderStackContributions,
  WEB_CLIENT_APP_TYPES,
  type StackContribution,
} from "../contributions/stack";
import type { VirtualFileSystem } from "../core/virtual-fs";
import type { RenderConfig } from "../types";
import type { TemplateData } from "./utils";

/** Select technology-local adapters without treating a physical apps/web path as an app type. */
export function planApiContributions(config: RenderConfig): StackContribution[] {
  if (config.api === "none" || config.backend === "convex") return [];

  const root = `api/${config.api}`;
  const owner = `api:${config.api}`;
  const plan: StackContribution[] = [];
  const webTarget = config.application ? `apps/${config.application.type}` : "apps/web";
  function add(
    source: string,
    target: string,
    appTypes?: readonly string[],
    kind: StackContribution["kind"] = "prefix",
  ) {
    plan.push({ source, target, owner, appTypes, kind, required: true });
  }

  add(`${root}/server`, "packages/api");
  if (config.backend !== "none" && acceptsStackApplication(config, ["fullstack-web", "backend"])) {
    const server = config.backend === "self" ? webTarget : "apps/server";
    add(`${root}/context.ts.hbs`, `${server}/src/context.ts`, ["fullstack-web", "backend"], "file");
  }

  if (acceptsStackApplication(config, WEB_CLIENT_APP_TYPES)) {
    const react = config.frontend.find((frontend) =>
      ["tanstack-router", "react-router", "tanstack-start", "next"].includes(frontend),
    );
    if (react) {
      add(`${root}/shared/client/frameworks/react/base`, webTarget, WEB_CLIENT_APP_TYPES);
      if (config.backend === "self" && (react === "next" || react === "tanstack-start")) {
        add(`${root}/apps/fullstack-web/frameworks/${react}`, webTarget, ["fullstack-web"]);
      }
    } else if (config.api === "orpc") {
      const framework = ["nuxt", "svelte", "solid", "astro"].find((candidate) =>
        config.frontend.some((frontend) => frontend === candidate),
      );
      if (framework) {
        if (framework === "nuxt" && config.backend === "self") {
          add(`${root}/apps/fullstack-web/frameworks/nuxt`, webTarget, ["fullstack-web"]);
          // Fullstack Nuxt supplies its own server/client transport, retaining only vue-query.
          add(
            `${root}/shared/client/frameworks/nuxt/app/plugins/vue-query.ts.hbs`,
            `${webTarget}/app/plugins/vue-query.ts`,
            WEB_CLIENT_APP_TYPES,
            "file",
          );
        } else {
          add(`${root}/shared/client/frameworks/${framework}`, webTarget, WEB_CLIENT_APP_TYPES);
          if (config.backend === "self") {
            add(`${root}/apps/fullstack-web/frameworks/${framework}`, webTarget, ["fullstack-web"]);
            if (framework === "svelte" && config.auth !== "better-auth") {
              add(
                `${root}/shared/server/svelte/hooks.server.ts.hbs`,
                `${webTarget}/src/hooks.server.ts`,
                ["fullstack-web"],
                "file",
              );
            }
          }
        }
      }
    }
  }
  if (
    acceptsStackApplication(config, ["native"]) &&
    config.frontend.some((frontend) => frontend.startsWith("native-"))
  ) {
    add(`${root}/apps/native`, "apps/native", ["native"]);
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
