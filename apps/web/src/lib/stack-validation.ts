import {
  getBackendDisabledOptions,
  supportsRuntimeBackend,
  supportsRuntimeDatabase,
  supportsDatabaseSetupRuntime,
  supportsServerDeployRuntime,
} from "@xstack/types";
import { ProjectNameSchema } from "@xstack/types";
import {
  allowedApisForFrontends,
  isFrontendAllowedWithBackend,
  validateAddonCompatibility,
  supportsPrismaWebDeploy,
  hasCloudflareNextPostgresConflict,
  getDesktopDeployConflict,
  TRPC_INCOMPATIBLE_FRONTENDS,
  supportsOrmDatabase,
  supportsDatabaseSetup,
  getDatabaseSetupDatabases,
} from "@xstack/types";

import { DEFAULT_STACK, type StackState, TECH_OPTIONS, isStackOption } from "@/lib/constant";
import { CATEGORY_ORDER } from "@/lib/stack-utils";

import { featureIssue, resolvableFeatures, stackAuth } from "./stack-features";
import {
  getStackBackend,
  getStackFrontends,
  getSelfBackendFrontend,
  isSelfHostedFullstackBackend,
} from "./stack-model";

export function validateProjectName(name: string): string | undefined {
  const basename = name.split(/[\\/]/).filter(Boolean).at(-1) || "";
  const result = ProjectNameSchema.safeParse(basename);
  return result.success ? undefined : result.error.issues[0]?.message;
}

const getCloudflareNextIssue = (stack: StackState) =>
  hasCloudflareNextPostgresConflict({ ...stack, frontend: stack.webFrontend })
    ? "This Prisma PostgreSQL setup with Next.js is temporarily unavailable on Cloudflare"
    : null;

const getDockerDesktopConflict = (stack: StackState) =>
  getDesktopDeployConflict(
    "docker",
    stack.addons,
    stack.webFrontend,
    getStackBackend(stack.backend),
    stackAuth(stack),
  );

const getPrismaDesktopConflict = (
  addons: StackState["addons"],
  frontend: StackState["webFrontend"],
) => getDesktopDeployConflict("prisma", addons, frontend);

function getAddonIssue(stack: StackState, addon: StackState["addons"][number]) {
  const result = validateAddonCompatibility(
    addon,
    getStackFrontends(stack),
    stackAuth(stack),
    getStackBackend(stack.backend),
  );
  return result.isCompatible ? null : (result.reason ?? "Incompatible addon");
}

export const getCategoryDisplayName = (categoryKey: string): string => {
  const result = categoryKey.replace(/([A-Z])/g, " $1");
  return result.charAt(0).toUpperCase() + result.slice(1);
};

interface CompatibilityResult {
  adjustedStack: StackState | null;
  notes: Record<string, { notes: string[]; hasIssue: boolean }>;
  changes: Array<{ category: string; message: string }>;
}

export const analyzeStackCompatibility = (stack: StackState): CompatibilityResult => {
  if (stack.yolo === "true") {
    return {
      adjustedStack: null,
      notes: {},
      changes: [],
    };
  }

  const nextStack = { ...stack };
  let changed = false;
  const notes: CompatibilityResult["notes"] = {};
  const changes: Array<{ category: string; message: string }> = [];

  for (const cat of CATEGORY_ORDER) {
    notes[cat] = { notes: [], hasIssue: false };
  }

  for (const key of getBackendDisabledOptions(getStackBackend(nextStack.backend))) {
    if (nextStack[key] === "none") continue;
    nextStack[key] = "none";
    changed = true;
    changes.push({
      category: "backend",
      message: `${getCategoryDisplayName(key)} set to 'none' (managed by ${nextStack.backend})`,
    });
  }

  if (nextStack.backend === "convex") {
    if (
      !nextStack.webFrontend.every((frontend) => isFrontendAllowedWithBackend(frontend, "convex"))
    ) {
      nextStack.webFrontend = nextStack.webFrontend.filter((frontend) =>
        isFrontendAllowedWithBackend(frontend, "convex"),
      );
      if (nextStack.webFrontend.length === 0) nextStack.webFrontend = ["none"];
      changed = true;
      changes.push({ category: "backend", message: "Removed incompatible Convex frontends" });
    }
  }

  if (isSelfHostedFullstackBackend(nextStack.backend)) {
    const frontend = getSelfBackendFrontend(nextStack.backend);
    if (frontend && !nextStack.webFrontend.includes(frontend)) {
      nextStack.webFrontend = [frontend];
      changed = true;
      changes.push({
        category: "backend",
        message: `Frontend set to '${frontend}' (required for fullstack backend)`,
      });
    }
  }

  if (
    nextStack.runtime === "workers" &&
    !supportsRuntimeBackend(nextStack.runtime, getStackBackend(nextStack.backend))
  ) {
    nextStack.backend = "hono";
    changed = true;
    changes.push({ category: "runtime", message: "Backend set to 'Hono' (required for Workers)" });
  }

  if (nextStack.runtime === "workers" && nextStack.serverDeploy === "none") {
    nextStack.serverDeploy = "cloudflare";
    changed = true;
    changes.push({
      category: "runtime",
      message: "Server deploy set to 'Cloudflare' (required for Workers)",
    });
  }

  if (!supportsRuntimeDatabase(nextStack.runtime, nextStack.database)) {
    nextStack.database = "sqlite";
    nextStack.orm = "drizzle";
    nextStack.dbSetup = "d1";
    changed = true;
    changes.push({
      category: "runtime",
      message: "Database changed to SQLite with D1 (MongoDB incompatible with Workers)",
    });
  }

  if (
    nextStack.runtime === "none" &&
    !supportsRuntimeBackend(nextStack.runtime, getStackBackend(nextStack.backend))
  ) {
    nextStack.runtime = DEFAULT_STACK.runtime;
    changed = true;
    changes.push({
      category: "runtime",
      message: `Runtime set to '${DEFAULT_STACK.runtime}' (required for this backend)`,
    });
  }

  if (nextStack.backend !== "convex" && nextStack.backend !== "none") {
    if (nextStack.database === "none") {
      if (nextStack.orm !== "none") {
        nextStack.orm = "none";
        changed = true;
        changes.push({ category: "database", message: "ORM set to 'None' (no database selected)" });
      }
      if (nextStack.dbSetup !== "none") {
        nextStack.dbSetup = "none";
        changed = true;
        changes.push({
          category: "database",
          message: "DB Setup set to 'None' (no database selected)",
        });
      }
    }

    if (nextStack.database === "mongodb") {
      if (!supportsOrmDatabase(nextStack.orm, nextStack.database)) {
        nextStack.orm = "prisma";
        changed = true;
        changes.push({
          category: "database",
          message: "ORM set to 'Prisma' (required for MongoDB)",
        });
      }
      if (!supportsDatabaseSetup(nextStack.dbSetup, nextStack.database)) {
        nextStack.dbSetup = "none";
        changed = true;
        changes.push({
          category: "database",
          message: "DB Setup set to 'None' (incompatible with MongoDB)",
        });
      }
    }

    if (supportsOrmDatabase("drizzle", nextStack.database)) {
      if (nextStack.orm === "none") {
        nextStack.orm = "drizzle";
        changed = true;
        changes.push({
          category: "database",
          message: "ORM set to 'Drizzle' (required for database)",
        });
      }
      if (nextStack.orm === "mongoose") {
        nextStack.orm = "drizzle";
        changed = true;
        changes.push({
          category: "database",
          message: "ORM set to 'Drizzle' (Mongoose only works with MongoDB)",
        });
      }
    }

    if (nextStack.orm !== "none" && nextStack.database === "none") {
      if (nextStack.orm === "mongoose") {
        nextStack.database = "mongodb";
        changed = true;
        changes.push({
          category: "orm",
          message: "Database set to 'MongoDB' (required for Mongoose)",
        });
      } else {
        nextStack.database = "sqlite";
        changed = true;
        changes.push({ category: "orm", message: "Database set to 'SQLite' (required for ORM)" });
      }
    }

    if (
      nextStack.dbSetup !== "docker" &&
      !supportsDatabaseSetup(nextStack.dbSetup, nextStack.database)
    ) {
      const database = getDatabaseSetupDatabases(nextStack.dbSetup)[0];
      if (database) {
        nextStack.database = database;
        changed = true;
        changes.push({
          category: "dbSetup",
          message: `Database set to '${database}' (required for ${nextStack.dbSetup})`,
        });
      }
    }
    if (nextStack.dbSetup === "d1") {
      if (isSelfHostedFullstackBackend(nextStack.backend)) {
        if (nextStack.webDeploy !== "cloudflare") {
          nextStack.webDeploy = "cloudflare";
          changed = true;
          changes.push({
            category: "dbSetup",
            message: "Web deploy set to 'Cloudflare' (required for D1 with fullstack backend)",
          });
        }
      } else {
        if (nextStack.runtime !== "workers" || nextStack.backend !== "hono") {
          nextStack.runtime = "workers";
          nextStack.backend = "hono";
          changed = true;
          changes.push({
            category: "dbSetup",
            message: "Runtime set to 'Workers' with 'Hono' (required for D1)",
          });
        }
        if (nextStack.serverDeploy !== "cloudflare") {
          nextStack.serverDeploy = "cloudflare";
          changed = true;
          changes.push({
            category: "dbSetup",
            message: "Server deploy set to 'Cloudflare' (required for D1 with Workers)",
          });
        }
      }
    }
    if (nextStack.dbSetup === "docker") {
      if (!supportsDatabaseSetup(nextStack.dbSetup, nextStack.database)) {
        nextStack.dbSetup = "none";
        changed = true;
        changes.push({
          category: "dbSetup",
          message: "DB Setup set to 'None' (SQLite doesn't need Docker)",
        });
      }
      if (
        !supportsDatabaseSetupRuntime(
          "docker",
          nextStack.runtime,
          getStackBackend(nextStack.backend),
        )
      ) {
        nextStack.dbSetup = "d1";
        changed = true;
        changes.push({
          category: "dbSetup",
          message: "DB Setup set to 'D1' (Docker incompatible with Workers)",
        });
      }
    }
  }

  if (nextStack.backend !== "convex" && nextStack.backend !== "none") {
    const needsOrpc = !allowedApisForFrontends(nextStack.webFrontend).includes("trpc");
    if (needsOrpc && nextStack.api === "trpc") {
      nextStack.api = "orpc";
      changed = true;
      changes.push({ category: "api", message: "API set to 'oRPC' (required for this frontend)" });
    }
  }

  const { features, removed } = resolvableFeatures(nextStack);
  if (removed.length) {
    nextStack.features = features.length ? features : ["none"];
    changed = true;
    changes.push(
      ...removed.map(({ feature, reason }) => ({
        category: "features",
        message: `${feature} removed (${reason})`,
      })),
    );
  }

  const incompatibleAddons = nextStack.addons.flatMap((addon) => {
    const issue = getAddonIssue(nextStack, addon);
    return issue ? [{ addon, issue }] : [];
  });
  if (incompatibleAddons.length) {
    nextStack.addons = nextStack.addons.filter(
      (addon) => !incompatibleAddons.some((entry) => entry.addon === addon),
    );
    if (!nextStack.addons.length) nextStack.addons = ["none"];
    changed = true;
    changes.push(
      ...incompatibleAddons.map(({ addon, issue }) => ({
        category: "addons",
        message: `${addon} removed (${issue})`,
      })),
    );
  }

  if (nextStack.webDeploy !== "none" && !nextStack.webFrontend.some((f) => f !== "none")) {
    nextStack.webDeploy = "none";
    changed = true;
    changes.push({ category: "webDeploy", message: "Web deploy set to 'None' (no web frontend)" });
  }

  if (nextStack.webDeploy === "docker") {
    const dockerDesktopConflict = getDockerDesktopConflict(nextStack);

    if (dockerDesktopConflict) {
      nextStack.webDeploy = "none";
      changed = true;
      changes.push({
        category: "webDeploy",
        message: `Web deploy set to 'None' (${dockerDesktopConflict.selectedDesktopAddons.join(" and ")} requires a static ${dockerDesktopConflict.affectedFrontend} build)`,
      });
    }
  }

  if (nextStack.webDeploy === "prisma" && !supportsPrismaWebDeploy(nextStack.webFrontend)) {
    nextStack.webDeploy = "none";
    changed = true;
    changes.push({
      category: "webDeploy",
      message: "Web deploy set to 'None' (Prisma requires a supported web frontend)",
    });
  }

  if (nextStack.webDeploy === "prisma") {
    const prismaDesktopConflict = getPrismaDesktopConflict(nextStack.addons, nextStack.webFrontend);
    if (prismaDesktopConflict) {
      nextStack.webDeploy = "none";
      changed = true;
      changes.push({
        category: "webDeploy",
        message: `Web deploy set to 'None' (${prismaDesktopConflict.selectedDesktopAddons.join(" and ")} requires a static ${prismaDesktopConflict.affectedFrontend} build)`,
      });
    }
  }

  const cloudflareNextIssue = getCloudflareNextIssue(nextStack);
  if (cloudflareNextIssue) {
    nextStack.webDeploy = "none";
    changed = true;
    changes.push({
      category: "webDeploy",
      message: `Web deploy set to 'None' (${cloudflareNextIssue})`,
    });
  }

  if (nextStack.serverDeploy === "cloudflare") {
    if (nextStack.runtime !== "workers" || nextStack.backend !== "hono") {
      nextStack.serverDeploy = "none";
      changed = true;
      changes.push({
        category: "serverDeploy",
        message: "Server deploy set to 'None' (Cloudflare requires Workers + Hono)",
      });
    }
  }

  if (!supportsServerDeployRuntime(nextStack.serverDeploy, nextStack.runtime)) {
    nextStack.serverDeploy = nextStack.runtime === "workers" ? "cloudflare" : "none";
    changed = true;
    changes.push({
      category: "serverDeploy",
      message: `Server deploy set to '${nextStack.serverDeploy}' (required for ${nextStack.runtime})`,
    });
  }

  return {
    adjustedStack: changed ? nextStack : null,
    notes,
    changes,
  };
};

// Gate upstream choices; dependent choices can remain enabled when selection will repair them.
export const getDisabledReason = (
  currentStack: StackState,
  category: keyof typeof TECH_OPTIONS,
  optionId: string,
): string | null => {
  if (currentStack.backend === "convex") {
    if (
      getBackendDisabledOptions("convex").some((key) => key === category) &&
      optionId !== "none"
    ) {
      return `Convex provides its own ${getCategoryDisplayName(category).toLowerCase()}`;
    }
    if (
      category === "webFrontend" &&
      isStackOption("webFrontend", optionId) &&
      !isFrontendAllowedWithBackend(optionId, "convex")
    ) {
      return `${optionId.charAt(0).toUpperCase() + optionId.slice(1)} is not compatible with Convex`;
    }
  }

  if (
    currentStack.backend === "none" &&
    optionId !== "none" &&
    getBackendDisabledOptions("none").some((key) => key === category)
  ) {
    return "No backend selected";
  }

  const fullstackFrontend = getSelfBackendFrontend(currentStack.backend);
  if (fullstackFrontend) {
    const name =
      TECH_OPTIONS.webFrontend.find((option) => option.id === fullstackFrontend)?.name ??
      fullstackFrontend;
    if (category === "runtime" && optionId !== "none")
      return `${name} fullstack uses built-in server routes`;
    if (
      category === "webFrontend" &&
      isStackOption("webFrontend", optionId) &&
      optionId !== fullstackFrontend
    )
      return `${name} fullstack requires ${name} frontend`;
    if (category === "serverDeploy" && optionId !== "none")
      return "Fullstack uses frontend deployment";
    if (
      category === "api" &&
      optionId === "trpc" &&
      !allowedApisForFrontends([fullstackFrontend]).includes("trpc")
    )
      return `tRPC is not compatible with ${name} (use oRPC)`;
  }

  if (category === "backend" && isStackOption("backend", optionId)) {
    const requiredFrontend = getSelfBackendFrontend(optionId);
    if (requiredFrontend && !currentStack.webFrontend.includes(requiredFrontend)) {
      const name =
        TECH_OPTIONS.webFrontend.find((option) => option.id === requiredFrontend)?.name ??
        requiredFrontend;
      return `Requires ${name} frontend`;
    }
    if (
      optionId === "convex" &&
      !currentStack.webFrontend.every((frontend) =>
        isFrontendAllowedWithBackend(frontend, "convex"),
      )
    ) {
      const incompatible = currentStack.webFrontend.includes("solid") ? "Solid" : "Astro";
      return `Convex is not compatible with ${incompatible}`;
    }
    if (
      currentStack.runtime === "workers" &&
      optionId !== "none" &&
      !supportsRuntimeBackend(currentStack.runtime, getStackBackend(optionId))
    ) {
      return "Workers runtime only works with Hono";
    }
  }

  if (category === "runtime") {
    if (
      optionId === "workers" &&
      !supportsRuntimeBackend(optionId, getStackBackend(currentStack.backend))
    ) {
      return "Workers requires Hono backend";
    }
    if (optionId === "none") {
      if (!supportsRuntimeBackend(optionId, getStackBackend(currentStack.backend))) {
        return "Runtime 'None' only for Convex or fullstack backends";
      }
    }
  }

  if (category === "database" && isStackOption("database", optionId)) {
    if (!supportsRuntimeDatabase(currentStack.runtime, optionId)) {
      return "MongoDB is not compatible with Workers runtime";
    }
  }

  if (
    category === "orm" &&
    isStackOption("orm", optionId) &&
    (!supportsOrmDatabase(optionId, currentStack.database) ||
      (optionId === "mongoose" && !supportsRuntimeDatabase(currentStack.runtime, "mongodb")))
  ) {
    if (currentStack.database === "none" && optionId !== "none") {
      return "Select a database first";
    }
    if (optionId === "mongoose") {
      if (currentStack.runtime === "workers") {
        return "Mongoose requires MongoDB, which is incompatible with Workers";
      }
      if (currentStack.database !== "mongodb") {
        return "Mongoose only works with MongoDB";
      }
    }
    if (optionId === "drizzle" && currentStack.database === "mongodb") {
      return "Drizzle does not support MongoDB";
    }
    if (optionId === "none" && currentStack.database !== "none") {
      return "Database requires an ORM";
    }
    return `${optionId} does not support ${currentStack.database}`;
  }

  if (category === "dbSetup" && isStackOption("dbSetup", optionId) && optionId !== "none") {
    if (currentStack.database === "none") {
      return "Select a database first";
    }

    if (!supportsDatabaseSetup(optionId, currentStack.database)) {
      const names = getDatabaseSetupDatabases(optionId).join(" or ");
      return `${TECH_OPTIONS.dbSetup.find((option) => option.id === optionId)?.name ?? optionId} requires ${names || "a compatible database"}`;
    }
    if (
      !supportsDatabaseSetupRuntime(
        optionId,
        currentStack.runtime,
        getStackBackend(currentStack.backend),
      )
    ) {
      return optionId === "d1"
        ? "D1 requires Cloudflare Workers runtime or a self fullstack backend"
        : "Docker is incompatible with Workers";
    }
  }

  if (category === "api" && optionId === "trpc") {
    const needsOrpc = !allowedApisForFrontends(currentStack.webFrontend).includes("trpc");
    if (needsOrpc) {
      const frontendName = currentStack.webFrontend.find((f) =>
        TRPC_INCOMPATIBLE_FRONTENDS.some((value) => value === f),
      );
      return `${frontendName} requires oRPC, not tRPC`;
    }
  }

  if (category === "features" && optionId !== "none") {
    const issue = featureIssue(currentStack, optionId);
    if (issue) return issue;
  }

  if (category === "addons" && isStackOption("addons", optionId)) {
    const issue = getAddonIssue(currentStack, optionId);
    if (issue) return issue;
    if (
      currentStack.webDeploy === "prisma" &&
      getPrismaDesktopConflict([optionId], currentStack.webFrontend)
    ) {
      return `${optionId} requires a static web build, but Prisma requires an executable server artifact`;
    }
  }

  if (category === "webDeploy" && optionId !== "none") {
    if (!currentStack.webFrontend.some((f) => f !== "none")) {
      return "Web deployment requires a web frontend";
    }
    if (optionId === "docker") {
      const dockerDesktopConflict = getDockerDesktopConflict(currentStack);
      if (dockerDesktopConflict) {
        return `Docker cannot serve the static output required by ${dockerDesktopConflict.selectedDesktopAddons.join(" and ")} on ${dockerDesktopConflict.affectedFrontend}`;
      }
    }
    if (optionId === "prisma" && !supportsPrismaWebDeploy(currentStack.webFrontend)) {
      return "Prisma requires TanStack Router, Next.js, Nuxt, Astro, React Router, TanStack Start, SvelteKit, or Solid";
    }
    if (optionId === "prisma") {
      const prismaDesktopConflict = getPrismaDesktopConflict(
        currentStack.addons,
        currentStack.webFrontend,
      );
      if (prismaDesktopConflict) {
        return `Prisma cannot deploy the static output required by ${prismaDesktopConflict.selectedDesktopAddons.join(" and ")} on ${prismaDesktopConflict.affectedFrontend}`;
      }
    }
    if (optionId === "cloudflare") {
      const issue = getCloudflareNextIssue({ ...currentStack, webDeploy: "cloudflare" });
      if (issue) return issue;
    }
  }

  if (
    category === "webDeploy" &&
    currentStack.dbSetup === "d1" &&
    isSelfHostedFullstackBackend(currentStack.backend) &&
    optionId !== "cloudflare"
  ) {
    return "D1 with a self fullstack backend requires Cloudflare web deployment";
  }

  if (category === "serverDeploy") {
    if (optionId === "cloudflare") {
      if (!supportsServerDeployRuntime(optionId, currentStack.runtime))
        return "Cloudflare requires Workers runtime";
      if (!supportsRuntimeBackend("workers", getStackBackend(currentStack.backend)))
        return "Cloudflare requires Hono backend";
    }
    if (optionId === "docker" && !supportsServerDeployRuntime(optionId, currentStack.runtime)) {
      return "Docker server deployment requires the Bun or Node runtime";
    }
    if (optionId === "vercel" && !supportsServerDeployRuntime(optionId, currentStack.runtime)) {
      return "Vercel server deployment requires the Node runtime";
    }
    if (optionId === "prisma" && !supportsServerDeployRuntime(optionId, currentStack.runtime)) {
      return "Prisma server deployment requires the Bun or Node runtime";
    }
    if (optionId !== "none") {
      if (
        getBackendDisabledOptions(getStackBackend(currentStack.backend)).some(
          (key) => key === "serverDeploy",
        )
      ) {
        return "Server deployment not needed for this backend";
      }
    }
    if (optionId === "none" && currentStack.runtime === "workers") {
      return "Workers requires server deployment";
    }
  }

  return null;
};

export const isOptionCompatible = (
  currentStack: StackState,
  category: keyof typeof TECH_OPTIONS,
  optionId: string,
): boolean => {
  if (currentStack.yolo === "true") {
    return true;
  }
  return getDisabledReason(currentStack, category, optionId) === null;
};
