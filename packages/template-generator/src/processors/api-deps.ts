import type { ProjectConfig, Frontend, API } from "@xstack/types";

import { appOutputPath } from "../contributions/context";
import type { VirtualFileSystem } from "../core/virtual-fs";
import { addPackageDependency, type AvailableDependencies } from "../utils/add-deps";

type FrontendType = {
  hasReactWeb: boolean;
  hasNuxtWeb: boolean;
  hasSvelteWeb: boolean;
  hasSolidWeb: boolean;
  hasAstroWeb: boolean;
  hasNative: boolean;
};

function getFrontendType(frontend: Frontend[]): FrontendType {
  return {
    hasReactWeb: frontend.some((f) =>
      ["tanstack-router", "react-router", "tanstack-start", "next"].includes(f),
    ),
    hasNuxtWeb: frontend.includes("nuxt"),
    hasSvelteWeb: frontend.includes("svelte"),
    hasSolidWeb: frontend.includes("solid"),
    hasAstroWeb: frontend.includes("astro"),
    hasNative: frontend.some((f) =>
      ["native-bare", "native-uniwind", "native-unistyles"].includes(f),
    ),
  };
}

export function processApiDeps(vfs: VirtualFileSystem, config: ProjectConfig): void {
  const { api, backend, frontend } = config;
  const frontendType = getFrontendType(frontend);

  if (backend === "convex") {
    addConvexDeps(vfs, config, frontendType);
    return;
  }

  if (api === "none") return;

  addApiPackageDeps(vfs, api);
  addServerDeps(vfs, config);
  addSelfBackendWebDeps(vfs, config);
  addWebClientDeps(vfs, config, frontendType);
  if (frontendType.hasNative) addNativeDeps(vfs, config);
  addQueryDeps(vfs, config);
}

function addApiPackageDeps(vfs: VirtualFileSystem, api: API): void {
  const pkgPath = "packages/api/package.json";
  if (!vfs.exists(pkgPath)) return;

  if (api === "trpc") {
    addPackageDependency({
      vfs,
      packagePath: pkgPath,
      dependencies: ["@trpc/server", "@trpc/client", "zod"],
    });
  } else if (api === "orpc") {
    addPackageDependency({
      vfs,
      packagePath: pkgPath,
      dependencies: ["@orpc/server", "@orpc/client", "@orpc/openapi", "@orpc/zod", "zod"],
    });
  }
}

function addServerDeps(vfs: VirtualFileSystem, config: ProjectConfig): void {
  const { api, backend } = config;
  const serverPath = appOutputPath(config, "server", "package.json");
  if (!vfs.ownsPath(serverPath) || !vfs.exists(serverPath) || backend === "self") return;

  if (backend === "convex") return;

  if (api === "trpc") {
    addPackageDependency({
      vfs,
      packagePath: serverPath,
      dependencies: backend === "hono" ? ["@trpc/server", "@hono/trpc-server"] : ["@trpc/server"],
    });
  } else if (api === "orpc") {
    addPackageDependency({
      vfs,
      packagePath: serverPath,
      dependencies: ["@orpc/server", "@orpc/openapi"],
    });
  }
}

function addSelfBackendWebDeps(vfs: VirtualFileSystem, config: ProjectConfig): void {
  const { api, backend } = config;
  if (backend !== "self") return;

  const webPath = appOutputPath(config, "server", "package.json");
  if (!vfs.ownsPath(webPath) || !vfs.exists(webPath)) return;

  // When backend is "self", add server deps to web too
  if (api === "trpc") {
    addPackageDependency({
      vfs,
      packagePath: webPath,
      dependencies: ["@trpc/server", "@trpc/client"],
    });
  } else if (api === "orpc") {
    addPackageDependency({
      vfs,
      packagePath: webPath,
      dependencies: ["@orpc/server", "@orpc/client", "@orpc/openapi", "@orpc/zod"],
    });
  }
}

function addWebClientDeps(
  vfs: VirtualFileSystem,
  config: ProjectConfig,
  frontendType: FrontendType,
): void {
  const { api, backend, frontend } = config;
  const webPath = appOutputPath(config, "web", "package.json");
  if (!vfs.ownsPath(webPath) || !vfs.exists(webPath) || backend === "convex") return;

  if (api === "trpc" && frontendType.hasReactWeb) {
    const deps: AvailableDependencies[] = [
      "@trpc/tanstack-react-query",
      "@trpc/client",
      "@trpc/server",
    ];
    if (frontend.includes("tanstack-start")) {
      deps.push("@tanstack/react-router-ssr-query");
    }
    addPackageDependency({
      vfs,
      packagePath: webPath,
      dependencies: deps,
    });
  } else if (api === "orpc" && frontendType.hasReactWeb) {
    const deps: AvailableDependencies[] = ["@orpc/tanstack-query", "@orpc/client", "@orpc/server"];
    if (frontend.includes("tanstack-start")) {
      deps.push("@tanstack/react-router-ssr-query");
    }
    addPackageDependency({
      vfs,
      packagePath: webPath,
      dependencies: deps,
    });
  } else if (api === "orpc" && frontendType.hasNuxtWeb) {
    addPackageDependency({
      vfs,
      packagePath: webPath,
      dependencies: ["@tanstack/vue-query", "@orpc/tanstack-query", "@orpc/client", "@orpc/server"],
      devDependencies: ["@tanstack/vue-query-devtools"],
    });
  } else if (api === "orpc" && frontendType.hasSvelteWeb) {
    addPackageDependency({
      vfs,
      packagePath: webPath,
      dependencies: [
        "@orpc/tanstack-query",
        "@orpc/client",
        "@orpc/server",
        "@tanstack/svelte-query",
      ],
      devDependencies: ["@tanstack/svelte-query-devtools"],
    });
  } else if (api === "orpc" && frontendType.hasSolidWeb) {
    addPackageDependency({
      vfs,
      packagePath: webPath,
      dependencies: [
        "@orpc/tanstack-query",
        "@orpc/client",
        "@orpc/server",
        "@tanstack/solid-query",
      ],
    });
  } else if (api === "orpc" && frontendType.hasAstroWeb) {
    // Astro uses vanilla oRPC client without TanStack Query
    addPackageDependency({
      vfs,
      packagePath: webPath,
      dependencies: ["@orpc/client"],
    });
  }
}

function addNativeDeps(vfs: VirtualFileSystem, config: ProjectConfig): void {
  const { api, backend } = config;
  const nativePath = appOutputPath(config, "native", "package.json");
  if (!vfs.ownsPath(nativePath) || !vfs.exists(nativePath)) return;

  if (backend === "convex") return;

  if (api === "trpc") {
    addPackageDependency({
      vfs,
      packagePath: nativePath,
      dependencies: ["@trpc/tanstack-react-query", "@trpc/client", "@trpc/server"],
    });
  } else if (api === "orpc") {
    addPackageDependency({
      vfs,
      packagePath: nativePath,
      dependencies: ["@orpc/tanstack-query", "@orpc/client"],
    });
  }
}

function addQueryDeps(vfs: VirtualFileSystem, config: ProjectConfig): void {
  const { frontend, backend } = config;
  const webPath = appOutputPath(config, "web", "package.json");
  const nativePath = appOutputPath(config, "native", "package.json");
  const frontendType = getFrontendType(frontend);

  if (frontendType.hasReactWeb && vfs.exists(webPath) && backend !== "convex") {
    addPackageDependency({
      vfs,
      packagePath: webPath,
      dependencies: ["@tanstack/react-query"],
      devDependencies: ["@tanstack/react-query-devtools"],
    });
  }

  if (frontendType.hasSolidWeb && vfs.exists(webPath) && backend !== "convex") {
    addPackageDependency({
      vfs,
      packagePath: webPath,
      dependencies: ["@tanstack/solid-query", "@tanstack/query-core"],
    });
  }

  if (frontendType.hasNative && vfs.exists(nativePath) && backend !== "convex") {
    addPackageDependency({
      vfs,
      packagePath: nativePath,
      dependencies: ["@tanstack/react-query"],
    });
  }
}

function addConvexDeps(
  vfs: VirtualFileSystem,
  config: ProjectConfig,
  frontendType: FrontendType,
): void {
  const { frontend } = config;
  const webPath = appOutputPath(config, "web", "package.json");
  const nativePath = appOutputPath(config, "native", "package.json");
  const webExists =
    frontend.some((item) => item !== "none" && !item.startsWith("native-")) &&
    vfs.ownsPath(webPath) &&
    vfs.exists(webPath);
  const nativeExists = vfs.ownsPath(nativePath) && vfs.exists(nativePath);

  if (webExists) {
    const deps: AvailableDependencies[] = ["convex"];
    if (frontend.includes("tanstack-start")) {
      deps.push("@convex-dev/react-query", "@tanstack/react-router-ssr-query");
    }
    if (frontend.includes("svelte")) {
      deps.push("convex-svelte");
    }
    if (frontend.includes("nuxt")) {
      deps.push("convex-nuxt", "convex-vue");
    }
    addPackageDependency({ vfs, packagePath: webPath, dependencies: deps });
  }

  if (nativeExists && frontendType.hasNative) {
    addPackageDependency({ vfs, packagePath: nativePath, dependencies: ["convex"] });
  }
}
