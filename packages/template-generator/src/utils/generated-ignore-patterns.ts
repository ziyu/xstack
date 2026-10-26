import type { ProjectConfig } from "@xstack/types";

import { appOutputPath } from "../contributions/context";
import type { RenderConfig } from "../types";

const NATIVE_GENERATED_PATTERNS = [
  "apps/native/.expo/**",
  "apps/native/dist/**",
  "apps/native/web-build/**",
  "apps/native/ios/**",
  "apps/native/android/**",
] as const;

const FRONTEND_GENERATED_PATTERNS = {
  "tanstack-router": ["apps/web/dist/**", "apps/web/.tanstack/**", "apps/web/src/routeTree.gen.ts"],
  "react-router": ["apps/web/build/**", "apps/web/.react-router/**"],
  "tanstack-start": [
    "apps/web/dist/**",
    "apps/web/.vinxi/**",
    "apps/web/.tanstack/**",
    "apps/web/src/routeTree.gen.ts",
  ],
  next: ["apps/web/.next/**", "apps/web/out/**"],
  nuxt: ["apps/web/.nuxt/**", "apps/web/.output/**", "apps/web/.data/**", "apps/web/.nitro/**"],
  svelte: ["apps/web/.svelte-kit/**", "apps/web/build/**", "apps/web/.output/**"],
  solid: ["apps/web/dist/**", "apps/web/.output/**"],
  astro: ["apps/web/dist/**", "apps/web/.astro/**"],
  "native-bare": NATIVE_GENERATED_PATTERNS,
  "native-uniwind": NATIVE_GENERATED_PATTERNS,
  "native-unistyles": NATIVE_GENERATED_PATTERNS,
  none: [],
} as const satisfies Partial<Record<ProjectConfig["frontend"][number], readonly string[]>>;

const SERVER_BUILD_BACKENDS = ["hono", "express", "fastify", "elysia"] as const;

export function getStackGeneratedIgnorePatterns(config: RenderConfig): string[] {
  const patterns = new Set<string>();

  for (const application of config.application?.workspaceApplications ?? []) {
    for (const frontend of application.frontend) {
      const prefix = frontend.startsWith("native-") ? "apps/native/" : "apps/web/";
      for (const pattern of FRONTEND_GENERATED_PATTERNS[frontend] ?? []) {
        patterns.add(`${application.directory}/${pattern.slice(prefix.length)}`);
      }
    }
    if (application.roles.includes("backend") || application.type === "cli") {
      patterns.add(`${application.directory}/dist/**`);
    }
    if (application.frontend.includes("next") && application.webDeploy === "cloudflare") {
      patterns.add(`${application.directory}/.open-next/**`);
    }
  }
  for (const frontend of config.application ? [] : config.frontend) {
    const frontendPatterns = FRONTEND_GENERATED_PATTERNS[frontend];
    if (!frontendPatterns) continue;
    for (const pattern of frontendPatterns) {
      const kind = frontend.startsWith("native-") ? "native" : "web";
      patterns.add(appOutputPath(config, kind, pattern.slice(`apps/${kind}/`.length)));
    }
  }

  if (
    !config.application &&
    (SERVER_BUILD_BACKENDS as readonly string[]).includes(config.backend)
  ) {
    patterns.add(appOutputPath(config, "server", "dist/**"));
  }

  if (config.database !== "none" && config.orm !== "none") {
    patterns.add("packages/db/dist/**");
  }
  if (config.api === "orpc" && !["convex", "none"].includes(config.backend)) {
    patterns.add("packages/api/dist/**");
    if (config.auth === "better-auth") patterns.add("packages/auth/dist/**");
  }

  if (
    config.database === "sqlite" &&
    config.orm !== "none" &&
    (config.dbSetup !== "d1" || config.orm === "prisma")
  ) {
    patterns.add("packages/db/local.db*");
  }

  if (config.orm === "prisma") {
    patterns.add("packages/db/prisma/generated/**");

    if (config.database === "sqlite" && config.dbSetup === "turso") {
      patterns.add("packages/db/prisma/**/*.db*");
    }
  }

  if (config.backend === "convex") {
    patterns.add("packages/backend/convex/_generated/**");
  }

  const hasCloudflare =
    config.runtime === "workers" ||
    config.dbSetup === "d1" ||
    config.webDeploy === "cloudflare" ||
    config.serverDeploy === "cloudflare";

  if (hasCloudflare) {
    patterns.add(".alchemy/**");
    patterns.add(".wrangler/**");
    patterns.add("**/.wrangler/**");

    if (!config.application && config.frontend.includes("next")) {
      patterns.add(appOutputPath(config, "web", ".open-next/**"));
    }
  }

  if (config.addons.includes("axiom")) {
    patterns.add(".alchemy/**");
  }

  if (config.webDeploy === "vercel" || config.serverDeploy === "vercel") {
    patterns.add(".vercel/**");
  }

  return [...patterns];
}
