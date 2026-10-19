import type { VirtualFileSystem } from "../core/virtual-fs";
import type { RenderConfig } from "../types";
import { processAddonsDeps } from "./addons-deps";
import { processAlchemyPlugins } from "./alchemy-plugins";
import { processApiDeps } from "./api-deps";
import { processAuthDeps } from "./auth-deps";
import { processAuthPlugins } from "./auth-plugins";
import { processBackendDeps } from "./backend-deps";
import { processDatabaseDeps } from "./db-deps";
import { processDeployDeps } from "./deploy-deps";
import { processEnvDeps } from "./env-deps";
import { processEnvVariables } from "./env-vars";
import { processFrontendDeps } from "./frontend-deps";
import { processInfraDeps } from "./infra-deps";
import { processNxConfig } from "./nx-generator";
import { processPwaPlugins } from "./pwa-plugins";
import { processReadme } from "./readme-generator";
import { processRuntimeDeps } from "./runtime-deps";
import { processTurboConfig } from "./turbo-generator";
import { processVitePlusConfig } from "./vite-plus-generator";
import { processWorkspaceDeps } from "./workspace-deps";

export function processDependencies(vfs: VirtualFileSystem, config: RenderConfig): void {
  processWorkspaceDeps(vfs, config);
  processFrontendDeps(vfs, config);
  processEnvDeps(vfs, config);
  processInfraDeps(vfs, config);
  processDatabaseDeps(vfs, config);
  processBackendDeps(vfs, config);
  processRuntimeDeps(vfs, config);
  processApiDeps(vfs, config);
  processAuthDeps(vfs, config);
  processDeployDeps(vfs, config);
  processAddonsDeps(vfs, config);
  processTurboConfig(vfs, config);
  processNxConfig(vfs, config);
  processVitePlusConfig(vfs, config);
}

export {
  processAddonsDeps,
  processApiDeps,
  processAuthDeps,
  processBackendDeps,
  processDatabaseDeps,
  processDeployDeps,
  processEnvDeps,
  processFrontendDeps,
  processInfraDeps,
  processNxConfig,
  processReadme,
  processRuntimeDeps,
  processTurboConfig,
  processVitePlusConfig,
  processWorkspaceDeps,
  processAuthPlugins,
  processAlchemyPlugins,
  processPwaPlugins,
  processEnvVariables,
};
