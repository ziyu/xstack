import type { StackContext } from "@xstack/template-generator";

import { DEFAULT_CONFIG } from "../constants";
import { withDbSetupMode } from "../helpers/core/db-setup-options";
import type {
  Addons,
  API,
  Backend,
  Database,
  DatabaseSetup,
  DbSetupOptions,
  Frontend,
  ORM,
  PackageManager,
  ProjectConfig,
  Runtime,
  ServerDeploy,
  WebDeploy,
} from "../types";
import { isSilent } from "../utils/context";
import { UserCancelledError } from "../utils/errors";
import { getAddonsChoice } from "./addons";
import { getApiChoice } from "./api";
import { getBackendFrameworkChoice } from "./backend";
import { getDatabaseChoice } from "./database";
import { getDBSetupChoice, getDbProvisioningChoice } from "./database-setup";
import { getFrontendChoice } from "./frontend";
import { getGitChoice } from "./git";
import { getinstallChoice } from "./install";
import { navigableGroup } from "./navigable-group";
import { getORMChoice } from "./orm";
import { getPackageManagerChoice } from "./package-manager";
import { getFeaturesChoice, impliedAuth } from "./product";
import { getRuntimeChoice } from "./runtime";
import { getServerDeploymentChoice } from "./server-deploy";
import { getDeploymentChoice } from "./web-deploy";

type PromptGroupResults = {
  frontend: Frontend[];
  backend: Backend;
  runtime: Runtime;
  database: Database;
  orm: ORM;
  api: API;
  features: string[];
  addons: Addons[];
  dbSetup: DatabaseSetup;
  git: boolean;
  packageManager: PackageManager;
  install: boolean;
  webDeploy: WebDeploy;
  serverDeploy: ServerDeploy;
  dbSetupMode: DbSetupOptions["mode"];
};

export async function gatherConfig(
  flags: Partial<ProjectConfig>,
  projectName: string,
  projectDir: string,
  relativePath: string,
  options: {
    skipCompatibilityChecks?: boolean;
    manualDb?: boolean;
    /** Features fixed by flags or presets; asked when undefined. */
    features?: string[];
  } = {},
) {
  if (isSilent()) {
    return {
      projectName,
      projectDir,
      relativePath,
      addonOptions: flags.addonOptions,
      dbSetupOptions: flags.dbSetupOptions,
      frontend: flags.frontend ?? [...DEFAULT_CONFIG.frontend],
      backend: flags.backend ?? DEFAULT_CONFIG.backend,
      runtime: flags.runtime ?? DEFAULT_CONFIG.runtime,
      database: flags.database ?? DEFAULT_CONFIG.database,
      orm: flags.orm ?? DEFAULT_CONFIG.orm,
      addons: flags.addons ?? [...DEFAULT_CONFIG.addons],
      git: flags.git ?? DEFAULT_CONFIG.git,
      packageManager: flags.packageManager ?? DEFAULT_CONFIG.packageManager,
      install: flags.install ?? DEFAULT_CONFIG.install,
      dbSetup: flags.dbSetup ?? DEFAULT_CONFIG.dbSetup,
      api: flags.api ?? DEFAULT_CONFIG.api,
      webDeploy: flags.webDeploy ?? DEFAULT_CONFIG.webDeploy,
      serverDeploy: flags.serverDeploy ?? DEFAULT_CONFIG.serverDeploy,
      features: options.features ?? [],
    };
  }

  const result = await navigableGroup<PromptGroupResults>(
    {
      frontend: ({ previousAnswer }) =>
        getFrontendChoice(flags.frontend, flags.backend, previousAnswer),
      backend: ({ results, previousAnswer }) =>
        getBackendFrameworkChoice(flags.backend, results.frontend, previousAnswer),
      runtime: ({ results, previousAnswer }) =>
        getRuntimeChoice(flags.runtime, results.backend, previousAnswer),
      api: ({ results, previousAnswer }) =>
        getApiChoice(flags.api, results.frontend, results.backend, previousAnswer) as Promise<API>,
      database: ({ results, previousAnswer }) =>
        getDatabaseChoice(flags.database, results.backend, results.runtime, previousAnswer),
      orm: ({ results, previousAnswer }) =>
        getORMChoice(
          flags.orm,
          results.database !== "none",
          results.database,
          results.backend,
          results.runtime,
          previousAnswer,
        ),
      dbSetup: ({ results, previousAnswer }) =>
        getDBSetupChoice(
          results.database ?? "none",
          flags.dbSetup,
          results.orm,
          results.backend,
          results.runtime,
          previousAnswer,
        ),
      addons: ({ results, previousAnswer }) =>
        getAddonsChoice(
          flags.addons,
          results.frontend,
          impliedAuth({ features: results.features ?? [] }, stackOf(results, flags)),
          results.backend,
          results.runtime,
          previousAnswer,
        ),
      features: ({ results, previousAnswer }) =>
        getFeaturesChoice(options.features, stackOf(results, flags), previousAnswer),
      webDeploy: ({ results, previousAnswer }) =>
        getDeploymentChoice(
          flags.webDeploy,
          results.runtime,
          results.backend,
          results.frontend,
          results.dbSetup,
          results.database,
          results.orm,
          results.addons,
          previousAnswer,
        ),
      serverDeploy: ({ results, previousAnswer }) =>
        getServerDeploymentChoice(
          flags.serverDeploy,
          results.runtime,
          results.backend,
          results.webDeploy,
          previousAnswer,
        ),
      dbSetupMode: ({ results, previousAnswer }) =>
        getDbProvisioningChoice(
          flags.dbSetupOptions?.mode ?? (options.manualDb === true ? "manual" : undefined),
          results.dbSetup,
          results.backend,
          results.webDeploy,
          results.serverDeploy,
          previousAnswer,
        ),
      git: ({ previousAnswer }) => getGitChoice(flags.git, previousAnswer),
      packageManager: ({ previousAnswer }) =>
        getPackageManagerChoice(flags.packageManager, previousAnswer),
      install: ({ previousAnswer }) => getinstallChoice(flags.install, previousAnswer),
    },
    {
      preselected: options.skipCompatibilityChecks ? flags : undefined,
      sections: [
        { label: "App", prompts: ["frontend", "backend", "runtime", "api"] },
        { label: "Data", prompts: ["database", "orm", "dbSetup"] },
        { label: "Product", prompts: ["features", "addons"] },
        {
          label: "Ship",
          prompts: ["webDeploy", "serverDeploy", "dbSetupMode", "git", "packageManager", "install"],
        },
      ],
      onCancel: () => {
        throw new UserCancelledError({ message: "Operation cancelled" });
      },
    },
  );

  return {
    projectName: projectName,
    projectDir: projectDir,
    relativePath: relativePath,
    addonOptions: flags.addonOptions,
    dbSetupOptions: withDbSetupMode(flags.dbSetupOptions, result.dbSetupMode),
    frontend: result.frontend,
    backend: result.backend,
    runtime: result.runtime,
    database: result.database,
    orm: result.orm,
    addons: result.addons,
    git: result.git,
    packageManager: result.packageManager,
    install: result.install,
    dbSetup: result.dbSetup,
    api: result.api,
    webDeploy: result.webDeploy,
    serverDeploy: result.serverDeploy,
    features: result.features,
  };
}

function stackOf(
  results: Partial<PromptGroupResults>,
  flags: Partial<ProjectConfig>,
): StackContext {
  return {
    projectName: flags.projectName ?? DEFAULT_CONFIG.projectName,
    frontend: results.frontend ?? [],
    backend: results.backend ?? DEFAULT_CONFIG.backend,
    database: results.database ?? DEFAULT_CONFIG.database,
    orm: results.orm ?? DEFAULT_CONFIG.orm,
    api: results.api ?? DEFAULT_CONFIG.api,
    webDeploy: results.webDeploy ?? flags.webDeploy ?? DEFAULT_CONFIG.webDeploy,
  };
}
