import {
  acceptsStackApplication,
  renderStackContributions,
  WEB_CLIENT_APP_TYPES,
  type StackContribution,
} from "../../contributions/stack";
import type { VirtualFileSystem } from "../../core/virtual-fs";
import type { TemplateData } from "../../template-handlers/utils";
import type { RenderConfig } from "../../types";

const STACK = "modules/auth/stack";
const REACT_FRAMEWORKS = ["tanstack-router", "react-router", "tanstack-start", "next"];

/** Legacy stack adapters, with explicit application applicability and intentional no-ops. */
export function planAuthContributions(config: RenderConfig): StackContribution[] {
  if (!config.auth || config.auth === "none") return [];

  const provider = config.auth;
  const root = `${STACK}/${provider}`;
  const owner = `auth:${provider}`;
  const plan: StackContribution[] = [];
  const web = acceptsStackApplication(config, WEB_CLIENT_APP_TYPES);
  const native = acceptsStackApplication(config, ["native"]);
  const react = web
    ? config.frontend.find((frontend) => REACT_FRAMEWORKS.includes(frontend))
    : undefined;
  const framework =
    react ??
    (web
      ? ["nuxt", "svelte", "solid", "astro"].find((frontend) =>
          config.frontend.some((selected) => selected === frontend),
        )
      : undefined);
  const nativeFramework = native
    ? ["bare", "uniwind", "unistyles"].find((variant) =>
        config.frontend.some((frontend) => frontend === `native-${variant}`),
      )
    : undefined;
  const webTarget = config.application ? `apps/${config.application.type}` : "apps/web";

  function add(
    source: string,
    target: string,
    appTypes?: readonly string[],
    optionalReason?: string,
    kind: StackContribution["kind"] = "prefix",
  ) {
    plan.push({ source, target, owner, appTypes, kind, required: !optionalReason, optionalReason });
  }

  if (config.backend === "convex") {
    const convex = `${root}/convex`;
    add(`${convex}/backend`, "packages/backend");
    if (react) {
      if (provider === "better-auth") {
        add(
          `${convex}/shared/client/frameworks/react/base`,
          webTarget,
          WEB_CLIENT_APP_TYPES,
          "Convex Better Auth clients are framework-specific; there is intentionally no shared React base.",
        );
      }
      add(`${convex}/shared/client/frameworks/react/${react}`, webTarget, WEB_CLIENT_APP_TYPES);
    }
    if (nativeFramework) {
      add(`${convex}/apps/native/base`, "apps/native", ["native"]);
      add(
        `${convex}/apps/native/${nativeFramework}`,
        "apps/native",
        ["native"],
        provider === "clerk"
          ? "Clerk's native base implements every styling variant without additional variant files."
          : undefined,
      );
    }
    return plan;
  }

  if (config.backend !== "none") {
    add(
      `${root}/server/base`,
      "packages/auth",
      undefined,
      provider === "clerk"
        ? "Clerk uses its SDK directly and has no local auth service package."
        : undefined,
    );
    if (config.orm !== "none" && config.database !== "none") {
      add(
        `${root}/server/db/${config.orm}/${config.database}`,
        "packages/db",
        undefined,
        provider === "clerk"
          ? "Clerk owns its identity database; no local auth schema is contributed."
          : undefined,
      );
    }
    if (framework === "solid" && provider === "better-auth") {
      add(`${root}/client/solid`, "packages/auth");
      add(
        `${root}/client/auth-client.ts.hbs`,
        `${webTarget}/src/client.ts`,
        WEB_CLIENT_APP_TYPES,
        undefined,
        "file",
      );
    }
  }

  if (react) {
    add(`${root}/shared/client/frameworks/react/base`, webTarget, WEB_CLIENT_APP_TYPES);
    add(`${root}/shared/client/frameworks/react/${react}`, webTarget, WEB_CLIENT_APP_TYPES);
    if (config.backend === "self" && (react === "next" || react === "tanstack-start")) {
      add(
        `${root}/apps/fullstack-web/frameworks/${react}`,
        webTarget,
        ["fullstack-web"],
        provider === "clerk"
          ? "Clerk uses hosted authentication and needs no local fullstack auth route."
          : undefined,
      );
    }
  } else if (framework) {
    if (config.backend === "self" && (framework === "nuxt" || provider === "better-auth")) {
      add(
        `${root}/apps/fullstack-web/frameworks/${framework}`,
        webTarget,
        ["fullstack-web"],
        provider === "clerk"
          ? "Clerk has no legacy Nuxt fullstack auth route contribution."
          : undefined,
      );
    }
    add(
      `${root}/shared/client/frameworks/${framework}`,
      webTarget,
      WEB_CLIENT_APP_TYPES,
      provider === "clerk"
        ? "Legacy Clerk adapters contribute UI only to React and native applications."
        : undefined,
    );
    if (framework === "svelte" && provider === "better-auth") {
      const serverLoader =
        config.backend === "self" ||
        (config.webDeploy === config.serverDeploy &&
          ["vercel", "docker"].includes(config.webDeploy));
      add(
        `${root}/loaders/svelte/dashboard.ts.hbs`,
        `${webTarget}/src/routes/dashboard/+page${serverLoader ? ".server" : ""}.ts`,
        WEB_CLIENT_APP_TYPES,
        undefined,
        "file",
      );
    }
  }

  if (nativeFramework) {
    add(`${root}/apps/native/base`, "apps/native", ["native"]);
    add(
      `${root}/apps/native/${nativeFramework}`,
      "apps/native",
      ["native"],
      provider === "clerk"
        ? "Clerk's native base implements every styling variant without additional variant files."
        : undefined,
    );
  }
  return plan;
}

export async function processAuthTemplates(
  vfs: VirtualFileSystem,
  templates: TemplateData,
  config: RenderConfig,
): Promise<void> {
  renderStackContributions(vfs, templates, config, planAuthContributions(config));
}
