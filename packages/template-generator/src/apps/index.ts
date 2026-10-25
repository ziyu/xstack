export { APPLICATION_TEMPLATES } from "../applications.generated";
export { readApplicationCatalog, readFrameworkCatalog, resolveApplications } from "./plan";
export type {
  ApplicationPlan,
  ApplicationIssue,
  ResolvedApplication,
  ResolvedApplicationAdapter,
  ResolvedFrameworkAdapter,
} from "./plan";
export { resolveApplicationConfig } from "./config";
export { resolveWorkspaceCapabilities } from "../contributions/capabilities";
export type { WorkspaceCapabilities, ModuleCapability } from "../contributions/capabilities";
export { resolveApplicationContext, appOutputPath } from "../contributions/context";
