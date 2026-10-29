import type { ProjectConfig } from "@xstack/types";

import { nativeSplitApplication, supportsNativeSplit } from "../modules/native-split";
import type { StackContext } from "../modules/types";
import type { ResolvedPlan } from "../modules/types";
import { GeneratorError } from "../types";
import type { ContributionRequirement } from "./inventory";

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
    const contract = module.manifest.sources ?? {};
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
          if (contract.integrations?.[integration]?.serverOnly) continue;
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
    const serviceApplication = contribution?.mode === "server" ? applicationType : "fullstack-web";
    const expand = (path: string) =>
      path.replaceAll("{application}", serviceApplication ?? "fullstack-web");
    for (const path of contract.required ?? []) requireSource(`module:${id}:${path}`, expand(path));
    if (contribution?.mode === "server")
      for (const path of contract.serverRequired ?? [])
        requireSource(`module:${id}:${path}`, expand(path));
    const moduleFrameworks = new Set(
      contribution
        ? contribution.frameworks
            .filter((layer) => layer.modules.includes(id))
            .map((layer) => layer.id)
        : frameworks,
    );
    requireSource(`module:${id}`, "files");
    for (const [framework, paths] of Object.entries(contract.frameworkRequired ?? {})) {
      if (moduleFrameworks.has(framework))
        for (const path of paths) requireSource(`module:${id}:${path}`, expand(path));
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
      for (const path of integrationContract.required ?? [])
        requireSource(`${source}:${path}`, expand(path));
    }
  }
  return requirements;
}
