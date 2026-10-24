export * from "./types";
export * from "./core/virtual-fs";
export * from "./core/template-processor";
export * from "./generator";
export { processPnpmWorkspaceConfig } from "./template-handlers/extras";
export { processAddonTemplates } from "./template-handlers/addons";
export { processAddonsDeps } from "./processors/addons-deps";
export { processPwaPlugins } from "./processors/pwa-plugins";
export { processNxConfig } from "./processors/nx-generator";
export { processTurboConfig } from "./processors/turbo-generator";
export { processVitePlusConfig } from "./processors/vite-plus-generator";
export { processPackageConfigs, processVercelConfig } from "./post-process";
export { writeXStackConfigToVfs } from "./xstack-config";

export { EMBEDDED_TEMPLATES, TEMPLATE_COUNT } from "./templates.generated";
export { dependencyVersionMap, type AvailableDependencies } from "./utils/add-deps";
export { generateReproducibleCommand } from "./utils/reproducible-command";

export { processNpmScriptApprovals } from "./post-process/package-configs";

export * from "./modules/types";
export { MODULE_CATALOG } from "./modules/catalog";
export { resolveModules, toSelection, hasErrors, toDeployTarget } from "./modules/resolver";
export { PRODUCT_PRESETS } from "./modules/presets";
export { getModulePlan, toRenderConfig } from "./modules/pipeline";
export { readApplicationCatalog, readFrameworkCatalog, resolveApplications } from "./apps/plan";
export type {
  ApplicationPlan,
  ResolvedApplication,
  ResolvedApplicationAdapter,
  ResolvedFrameworkAdapter,
} from "./apps/plan";
export { resolveApplicationConfig } from "./apps/config";
export { resolveWorkspaceCapabilities } from "./contributions/capabilities";
export type { WorkspaceCapabilities, ModuleCapability } from "./contributions/capabilities";
export {
  inventoryContributions,
  assertContributionInventory,
  contributionMatrix,
  queryContributions,
} from "./contributions/inventory";
export type {
  ContributionInventory,
  ContributionEntry,
  ContributionIssue,
} from "./contributions/inventory";
export { planStackContributions } from "./contributions/preflight";
export { planAuthContributions } from "./modules/stack/auth";
export { planApiContributions } from "./template-handlers/api";
export type { StackContribution } from "./contributions/stack";
export { requiredModuleContributions } from "./contributions/requirements";
export { buildWorkspacePlan } from "./contributions/workspace";
export type { WorkspacePlan } from "./contributions/workspace";
