import { appOutputPath } from "../contributions/context";
import type { VirtualFileSystem } from "../core/virtual-fs";
import type { RenderConfig } from "../types";
import {
  addPackageDependency,
  getBackendConsumerFrontends,
  type AvailableDependencies,
} from "../utils/add-deps";

// Intentional: @convex-dev/better-auth's AuthClient type rejects better-auth >=1.6.18
// clients (get-convex/better-auth#420), so Convex projects pin the last compatible release.
const CONVEX_BETTER_AUTH_VERSION = "1.6.17";

export function processAuthDeps(vfs: VirtualFileSystem, config: RenderConfig): void {
  const { auth, backend } = config;
  if (!auth || auth === "none") return;

  if (backend === "convex") {
    processConvexAuthDeps(vfs, config);
  } else {
    processStandardAuthDeps(vfs, config);
  }
}

function processConvexAuthDeps(vfs: VirtualFileSystem, config: RenderConfig): void {
  const { auth, frontend } = config;
  const webPath = appOutputPath(config, "web", "package.json");
  const nativePath = appOutputPath(config, "native", "package.json");
  const backendPath = "packages/backend/package.json";

  const webExists =
    frontend.some((item) => item !== "none" && !item.startsWith("native-")) &&
    vfs.ownsPath(webPath) &&
    vfs.exists(webPath);
  const nativeExists = vfs.ownsPath(nativePath) && vfs.exists(nativePath);
  const backendExists = vfs.ownsPath(backendPath) && vfs.exists(backendPath);

  const hasNative = frontend.some((f) =>
    ["native-bare", "native-uniwind", "native-unistyles"].includes(f),
  );
  const backendHasNative = getBackendConsumerFrontends(config).some((frontend) =>
    frontend.startsWith("native-"),
  );
  const hasNextJs = frontend.includes("next");
  const hasReactRouter = frontend.includes("react-router");
  const hasTanStackRouter = frontend.includes("tanstack-router");
  const hasTanStackStart = frontend.includes("tanstack-start");
  const hasViteReact = hasReactRouter || hasTanStackRouter;
  const hasSvelte = frontend.includes("svelte");
  const hasReactWebAuthForms = hasNextJs || hasTanStackStart || hasViteReact;

  if (auth === "clerk") {
    if (webExists) {
      if (hasNextJs) {
        addPackageDependency({ vfs, packagePath: webPath, dependencies: ["@clerk/nextjs"] });
      } else if (hasReactRouter) {
        addPackageDependency({ vfs, packagePath: webPath, dependencies: ["@clerk/react-router"] });
      } else if (hasTanStackRouter) {
        addPackageDependency({ vfs, packagePath: webPath, dependencies: ["@clerk/react"] });
      } else if (hasTanStackStart) {
        addPackageDependency({
          vfs,
          packagePath: webPath,
          dependencies: ["@clerk/tanstack-react-start"],
        });
      }
    }
    if (nativeExists && hasNative) {
      addPackageDependency({ vfs, packagePath: nativePath, dependencies: ["@clerk/expo"] });
    }
  } else if (auth === "better-auth") {
    if (backendExists) {
      addPackageDependency({
        vfs,
        packagePath: backendPath,
        dependencies: ["better-auth", "@convex-dev/better-auth"],
        customDependencies: {
          "better-auth": CONVEX_BETTER_AUTH_VERSION,
        },
      });
      if (backendHasNative) {
        addPackageDependency({
          vfs,
          packagePath: backendPath,
          dependencies: ["@better-auth/expo"],
          customDependencies: {
            "@better-auth/expo": CONVEX_BETTER_AUTH_VERSION,
          },
        });
      }
    }

    if (webExists) {
      addPackageDependency({
        vfs,
        packagePath: webPath,
        dependencies: ["better-auth", "@convex-dev/better-auth"],
        customDependencies: {
          "better-auth": CONVEX_BETTER_AUTH_VERSION,
        },
      });

      if (hasReactWebAuthForms) {
        addPackageDependency({ vfs, packagePath: webPath, dependencies: ["@tanstack/react-form"] });
      }
      if (hasSvelte) {
        addPackageDependency({
          vfs,
          packagePath: webPath,
          dependencies: ["@tanstack/svelte-form"],
        });
      }
    }

    if (nativeExists && hasNative) {
      addPackageDependency({
        vfs,
        packagePath: nativePath,
        dependencies: [
          "better-auth",
          "@better-auth/expo",
          "@convex-dev/better-auth",
          "@tanstack/react-form",
        ],
        customDependencies: {
          "better-auth": CONVEX_BETTER_AUTH_VERSION,
          "@better-auth/expo": CONVEX_BETTER_AUTH_VERSION,
        },
      });
    }
  }
}

function processStandardAuthDeps(vfs: VirtualFileSystem, config: RenderConfig): void {
  const { auth, backend, frontend, orm } = config;
  const authPath = "packages/auth/package.json";
  const apiPath = appOutputPath(config, "server", "package.json");
  const webPath = appOutputPath(config, "web", "package.json");
  const nativePath = appOutputPath(config, "native", "package.json");
  const serverPath = appOutputPath(config, "server", "package.json");

  const authExists = vfs.ownsPath(authPath) && vfs.exists(authPath);
  const apiExists = vfs.exists("packages/api/package.json");
  const webExists =
    frontend.some((item) => item !== "none" && !item.startsWith("native-")) &&
    vfs.ownsPath(webPath) &&
    vfs.exists(webPath);
  const nativeExists = vfs.ownsPath(nativePath) && vfs.exists(nativePath);
  const serverExists =
    (!config.application || config.application.roles.includes("backend")) &&
    vfs.ownsPath(serverPath) &&
    vfs.exists(serverPath);

  const hasNative = frontend.some((f) =>
    ["native-bare", "native-uniwind", "native-unistyles"].includes(f),
  );
  const backendHasNative = getBackendConsumerFrontends(config).some((frontend) =>
    frontend.startsWith("native-"),
  );
  const hasWebFrontend = frontend.some((f) =>
    [
      "react-router",
      "tanstack-router",
      "tanstack-start",
      "next",
      "nuxt",
      "svelte",
      "solid",
      "astro",
    ].includes(f),
  );
  const hasReactWebAuthForms = frontend.some((f) =>
    ["react-router", "tanstack-router", "tanstack-start", "next"].includes(f),
  );
  const hasSvelte = frontend.includes("svelte");
  const hasNextJs = frontend.includes("next");
  const hasReactRouter = frontend.includes("react-router");
  const hasTanStackRouter = frontend.includes("tanstack-router");
  const hasTanStackStart = frontend.includes("tanstack-start");

  if (auth === "clerk") {
    if (webExists) {
      if (hasNextJs) {
        addPackageDependency({ vfs, packagePath: webPath, dependencies: ["@clerk/nextjs"] });
      } else if (hasReactRouter) {
        addPackageDependency({ vfs, packagePath: webPath, dependencies: ["@clerk/react-router"] });
      } else if (hasTanStackRouter) {
        addPackageDependency({ vfs, packagePath: webPath, dependencies: ["@clerk/react"] });
      } else if (hasTanStackStart) {
        addPackageDependency({
          vfs,
          packagePath: webPath,
          dependencies: ["@clerk/tanstack-react-start"],
        });
      }
    }

    if (hasNative && nativeExists) {
      addPackageDependency({ vfs, packagePath: nativePath, dependencies: ["@clerk/expo"] });
    }

    if (apiExists) {
      addPackageDependency({
        vfs,
        packagePath: "packages/api/package.json",
        dependencies: ["@clerk/backend"],
      });
      if (backend === "self" || backend === "hono" || backend === "elysia") {
        addPackageDependency({ vfs, packagePath: apiPath, dependencies: ["@clerk/backend"] });
      } else if (backend === "express") {
        addPackageDependency({ vfs, packagePath: apiPath, dependencies: ["@clerk/express"] });
      } else if (backend === "fastify") {
        addPackageDependency({ vfs, packagePath: apiPath, dependencies: ["@clerk/fastify"] });
      }
    }

    if (serverExists) {
      if (backend === "express") {
        addPackageDependency({ vfs, packagePath: serverPath, dependencies: ["@clerk/express"] });
      } else if (backend === "fastify") {
        addPackageDependency({ vfs, packagePath: serverPath, dependencies: ["@clerk/fastify"] });
      }
    }
  } else if (auth === "better-auth") {
    if (authExists) {
      const authDependencies: AvailableDependencies[] = ["better-auth"];
      if (orm === "drizzle") {
        // The adapter peers on ^core; pin it to Better Auth so npm cannot install incompatible types.
        authDependencies.push("@better-auth/core", "@better-auth/drizzle-adapter", "drizzle-orm");
      }
      if (orm === "mongoose") {
        authDependencies.push("mongodb");
      }
      addPackageDependency({ vfs, packagePath: authPath, dependencies: authDependencies });
      if (backend === "self" && frontend.includes("tanstack-start")) {
        const startVersion = vfs.readJson<{ dependencies?: Record<string, string> }>(webPath)
          ?.dependencies?.["@tanstack/react-start"];
        if (startVersion) {
          addPackageDependency({
            vfs,
            packagePath: authPath,
            customDependencies: { "@tanstack/react-start": startVersion },
          });
        }
      }
      if (backendHasNative) {
        addPackageDependency({ vfs, packagePath: authPath, dependencies: ["@better-auth/expo"] });
      }
    }

    if (hasWebFrontend && webExists) {
      addPackageDependency({ vfs, packagePath: webPath, dependencies: ["better-auth"] });

      if (hasReactWebAuthForms) {
        addPackageDependency({ vfs, packagePath: webPath, dependencies: ["@tanstack/react-form"] });
      }
      if (hasSvelte) {
        addPackageDependency({
          vfs,
          packagePath: webPath,
          dependencies: ["@tanstack/svelte-form"],
        });
      }
    }

    if (hasNative && nativeExists) {
      addPackageDependency({
        vfs,
        packagePath: nativePath,
        dependencies: ["better-auth", "@better-auth/expo", "@tanstack/react-form"],
      });
    }
  }
}
