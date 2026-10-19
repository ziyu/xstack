import { OssStats } from "@erquhart/convex-oss-stats";

import { components } from "./_generated/api";

export const ossStats = new OssStats(components.ossStats, {
  githubOwners: ["AmanVarshney01"],
  githubRepos: ["ziyu/xstack"],
  npmPackages: ["xstack"],
});

export const {
  sync,
  clearAndSync,
  getGithubOwner,
  getNpmOrg,
  getGithubRepo,
  getGithubRepos,
  getNpmPackage,
  getNpmPackages,
} = ossStats.api();
