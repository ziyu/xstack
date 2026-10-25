import type { ProjectConfig } from "@xstack/types";

import { nativeSplitApplication, supportsNativeSplit } from "../modules/native-split";
import type { StackContext } from "../modules/types";
import type { ResolvedPlan } from "../modules/types";
import { GeneratorError } from "../types";
import type { ContributionRequirement } from "./inventory";

interface SourceContract {
  /** Direct workspace-relative payload, excluding child framework overlays. */
  base?: string;
  frameworks?: Record<string, string>;
}

interface ModuleSourceContract {
  dialects?: true;
  frameworks?: readonly string[];
  providers?:
    | { mode: "inline"; source: string }
    | { mode: "separate"; frameworks?: Record<string, Record<string, string>> };
  integrations?: Record<string, SourceContract>;
}

interface ModuleSourceCatalog {
  [moduleId: string]: ModuleSourceContract;
}

const UI_FRAMEWORKS = ["http-server", "next", "nuxt", "tanstack-start"];
const REACT_UI_FRAMEWORKS = [...UI_FRAMEWORKS, "react"];
const ADMIN_INTEGRATION: SourceContract = {
  frameworks: {
    next: "integrations/admin/frameworks/next",
    "tanstack-start": "integrations/admin/frameworks/tanstack-start",
    nuxt: "frameworks/nuxt",
  },
};
const AUTH_INTEGRATION: SourceContract = {
  frameworks: {
    next: "integrations/email/frameworks/next",
    react: "integrations/email/frameworks/react",
    "tanstack-start": "integrations/email/frameworks/tanstack-start",
    nuxt: "frameworks/nuxt/apps/fullstack-web/app/components/ProductAuth.vue.hbs",
  },
};

/** Authored contracts, not a list derived from whatever files survived in an input template map. */
const MODULE_SOURCES: ModuleSourceCatalog = {
  core: { frameworks: UI_FRAMEWORKS },
  i18n: { frameworks: ["react", "next", "tanstack-start"] },
  auth: {
    dialects: true,
    frameworks: REACT_UI_FRAMEWORKS,
    providers: { mode: "inline", source: "files/packages/auth/src/index.ts.hbs" },
    integrations: {
      email: AUTH_INTEGRATION,
      sms: {
        base: "integrations/sms/packages",
        frameworks: {
          next: "integrations/sms/frameworks/next",
          react: "integrations/sms/frameworks/react",
          "tanstack-start": "integrations/sms/frameworks/tanstack-start",
          nuxt: "frameworks/nuxt/apps/fullstack-web/app/components/ProductAuth.vue.hbs",
        },
      },
    },
  },
  admin: { frameworks: UI_FRAMEWORKS },
  email: {
    providers: { mode: "separate" },
    integrations: { auth: { base: "integrations/auth/apps/fullstack-web" } },
  },
  sms: {
    providers: { mode: "separate" },
    integrations: { auth: { base: "integrations/auth/apps/fullstack-web" } },
  },
  payment: {
    dialects: true,
    frameworks: UI_FRAMEWORKS,
    providers: {
      mode: "separate",
      frameworks: { mock: { next: "providers/mock/frameworks/next" } },
    },
    integrations: { admin: ADMIN_INTEGRATION },
  },
  credits: {
    dialects: true,
    frameworks: UI_FRAMEWORKS,
    integrations: {
      admin: ADMIN_INTEGRATION,
      payment: { base: "integrations/payment/apps/fullstack-web" },
    },
  },
  storage: {
    dialects: true,
    frameworks: REACT_UI_FRAMEWORKS,
    providers: { mode: "inline", source: "files/packages/storage/src/provider.ts.hbs" },
  },
  ai: {
    dialects: true,
    frameworks: REACT_UI_FRAMEWORKS,
    providers: { mode: "separate" },
    integrations: {
      credits: { base: "integrations/credits/apps/fullstack-web" },
      storage: { base: "integrations/storage/apps/fullstack-web" },
    },
  },
  blog: {
    dialects: true,
    frameworks: REACT_UI_FRAMEWORKS,
    integrations: { seo: { base: "integrations/seo/apps/fullstack-web" } },
  },
  seo: {
    frameworks: UI_FRAMEWORKS,
    integrations: {
      core: {
        frameworks: {
          next: "integrations/core/frameworks/next",
          nuxt: "frameworks/nuxt",
          "tanstack-start": "frameworks/tanstack-start",
        },
      },
      payment: { base: "integrations/payment/apps/fullstack-web" },
    },
  },
  affiliate: {
    dialects: true,
    frameworks: UI_FRAMEWORKS,
    integrations: { admin: ADMIN_INTEGRATION },
  },
  captcha: {
    frameworks: ["http-server", "react", "next", "nuxt"],
    providers: { mode: "inline", source: "files/packages/captcha/src/index.ts.hbs" },
  },
};

/** Resolve required native sources before rendering. Legacy stack sources have their own plan. */
export function requiredModuleContributions(
  config: Pick<ProjectConfig, "frontend" | "database"> & Partial<StackContext>,
  plan: ResolvedPlan,
): ContributionRequirement[] {
  const requirements: ContributionRequirement[] = [];
  const contribution =
    config.backend !== undefined &&
    config.orm !== undefined &&
    config.api !== undefined &&
    config.webDeploy !== undefined &&
    config.projectName !== undefined &&
    supportsNativeSplit(config as StackContext)
      ? nativeSplitApplication(config as StackContext)
      : undefined;
  const splitClient = contribution?.mode === "client";
  const applicationType = config.moduleApplication?.type;
  const frameworks = new Set<string>(contribution ? [] : config.frontend);
  if (frameworks.has("tanstack-start") || frameworks.has("nuxt")) frameworks.add("http-server");
  if (frameworks.has("next") || frameworks.has("tanstack-start")) frameworks.add("react");
  for (const module of plan.modules) {
    if (module.variant !== "native") continue;
    const id = module.manifest.id;
    const contract = MODULE_SOURCES[id];
    if (!contract) {
      throw new GeneratorError({
        phase: "contributions",
        message: `No native contribution source contract for module ${id}`,
      });
    }
    const base = `modules/${id}`;
    const requireSource = (source: string, relative: string) => {
      requirements.push({ source, module: id, sourcePrefix: `${base}/${relative}` });
    };
    for (const layer of contribution?.frameworks ?? []) {
      if (!layer.modules.includes(id)) continue;
      requireSource(
        `module:${id}:framework:${layer.id}`,
        `frameworks/${layer.id}/apps/${applicationType}`,
      );
    }
    if (splitClient) {
      const client = contribution!.client!;
      if (client.modules.includes(id)) {
        requireSource(
          `module:${id}:client:${client.framework}`,
          `shared/client/frameworks/${client.framework}`,
        );
        for (const integration of module.integrations) {
          if (!client.integrations.includes(integration))
            throw new GeneratorError({
              phase: "contributions",
              message: `No client integration contribution for ${id}:${integration}`,
            });
          requireSource(
            `module:${id}:client:${integration}`,
            `integrations/${integration}/shared/client/frameworks/${client.framework}`,
          );
        }
      }
      continue;
    }
    if (id === "core") requireSource("module:core:site", "shared/partials/site.hbs");
    if (contribution?.mode === "server" && id === "core")
      requireSource("module:core:application", `files/apps/${applicationType}`);
    const moduleFrameworks = new Set(
      contribution
        ? contribution.frameworks
            .filter((layer) => layer.modules.includes(id))
            .map((layer) => layer.id)
        : frameworks,
    );
    requireSource(`module:${id}`, "files");
    if (moduleFrameworks.has("http-server")) {
      const partials = {
        core: ["product-api"],
        auth: ["social-providers", "social-providers.server"],
        admin: ["admin"],
        captcha: ["captcha"],
      };
      if (id === "core" || id === "auth" || id === "admin" || id === "captcha")
        for (const partial of partials[id])
          requireSource(`module:${id}:partial:${partial}`, `shared/partials/${partial}.hbs`);
    }
    if (contract.dialects)
      requireSource(`module:${id}:dialect:${config.database}`, `dialects/${config.database}`);
    for (const framework of contract.frameworks ?? []) {
      if (!contribution && frameworks.has(framework))
        requireSource(`module:${id}:framework:${framework}`, `frameworks/${framework}`);
    }
    for (const provider of module.providers) {
      const source = `module:${id}:provider:${provider}`;
      const providerContract = contract.providers;
      if (!providerContract) {
        throw new GeneratorError({
          phase: "contributions",
          message: `No provider contribution source contract for ${id}:${provider}`,
        });
      }
      requireSource(
        source,
        providerContract.mode === "inline"
          ? providerContract.source
          : `providers/${provider}/packages`,
      );
      if (providerContract.mode === "separate") {
        for (const [framework, relative] of Object.entries(
          providerContract.frameworks?.[provider] ?? {},
        )) {
          if (moduleFrameworks.has(framework))
            requireSource(`${source}:framework:${framework}`, relative);
        }
      }
    }
    for (const integration of module.integrations) {
      const source = `module:${id}:integration:${integration}`;
      const integrationContract = contract.integrations?.[integration];
      if (!integrationContract) {
        throw new GeneratorError({
          phase: "contributions",
          message: `No integration contribution source contract for ${id}:${integration}`,
        });
      }
      if (integrationContract.base)
        requireSource(
          source,
          contribution?.mode === "server"
            ? integrationContract.base.replace("apps/fullstack-web", `apps/${applicationType}`)
            : integrationContract.base,
        );
      for (const [framework, relative] of Object.entries(integrationContract.frameworks ?? {})) {
        if (moduleFrameworks.has(framework))
          requireSource(`${source}:framework:${framework}`, relative);
      }
      if ((id === "email" || id === "sms") && integration === "auth")
        requireSource(`${source}:partial`, `shared/partials/auth-${id}.hbs`);
    }
  }
  return requirements;
}
