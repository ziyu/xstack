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
