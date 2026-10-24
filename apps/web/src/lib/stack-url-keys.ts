import type { UrlKeys } from "nuqs";

import type { StackState } from "@/lib/constant";

type StackUrlState = StackState & { viewMode: string; selectedFile: string };

export const stackUrlKeys: UrlKeys<StackUrlState> = {
  projectName: "name",
  apps: "apps",
  webFrontend: "fe-w",
  nativeFrontend: "fe-n",
  runtime: "rt",
  backend: "be",
  api: "api",
  database: "db",
  orm: "orm",
  dbSetup: "dbs",
  packageManager: "pm",
  addons: "add",
  features: "ft",
  providers: "providers",
  moduleOptions: "module-options",
  git: "git",
  install: "i",
  webDeploy: "wd",
  serverDeploy: "sd",
  yolo: "yolo",
  viewMode: "view",
  selectedFile: "file",
};

/** Names and view controls do not opt a fresh Builder into legacy technology mode. */
export function usesDefaultApplications(params: { has: (key: string) => boolean }): boolean {
  return !Object.entries(stackUrlKeys).some(
    ([key, urlKey]) =>
      !["projectName", "viewMode", "selectedFile"].includes(key) && params.has(urlKey),
  );
}
