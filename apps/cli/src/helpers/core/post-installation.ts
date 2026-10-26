import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { box, log } from "@clack/prompts";
import type { RenderConfig } from "@xstack/template-generator";
import pc from "picocolors";

import type {
  Backend,
  Database,
  DatabaseSetup,
  Frontend,
  ORM,
  DbSetupOptions,
  Runtime,
  ServerDeploy,
  WebDeploy,
} from "../../types";
import {
  getLocalD1Owner,
  isAlchemyDeployTarget,
  usesAlchemyManagedDatabase,
  webFrontends,
} from "../../types";
import { getDockerStatus } from "../../utils/docker-utils";
import {
  fetchSponsorsQuietly,
  formatPostInstallSpecialSponsorsSection,
} from "../../utils/sponsors";
import { cliLog } from "../../utils/terminal-output";
import { resolveWorkspaceApplications, type WorkspaceApplication } from "../workspace-applications";

function getDesktopStaticBuildNote(frontend: Frontend[]): string {
  const labels = {
    "tanstack-start": "TanStack Start",
    next: "Next.js",
    nuxt: "Nuxt",
    svelte: "SvelteKit",
    astro: "Astro",
  } as const satisfies Partial<Record<Frontend, string>>;
  const selected = frontend.flatMap((value) =>
    Object.hasOwn(labels, value) ? [labels[value as keyof typeof labels]] : [],
  );
  return selected.length
    ? `${pc.yellow("NOTE:")} Desktop builds package static web assets.\n   ${selected.join(", ")} require a static/export web build before desktop packaging will work.`
    : "";
}

export async function displayPostInstallInstructions(
  config: RenderConfig & { depsInstalled: boolean },
) {
  const {
    database,
    relativePath,
    packageManager,
    depsInstalled,
    orm,
    addons,
    runtime,
    frontend: configuredFrontend,
    backend,
    dbSetup,
    webDeploy,
    serverDeploy,
    dbSetupOptions,
  } = config;
  const resolved = await resolveWorkspaceApplications(config);
  if (resolved.isErr()) throw resolved.error;
  const applications = resolved.value;
  const frontend = applications.length
    ? applications.flatMap((app) => app.stack.frontend ?? [])
    : configuredFrontend;
  const webApplications = applications.filter((app) =>
    app.roles.some((role) => role === "web-frontend" || role === "admin"),
  );
  const nativeApplications = applications.filter((app) =>
    app.stack.frontend?.some((value) => value.startsWith("native-")),
  );
  const backendApplication = applications.find((app) => app.roles.includes("backend"));
  const backendRoot = backendApplication?.directory;
  const appScripts = new Map<string, Record<string, string>>();
  for (const app of applications) {
    const manifest = JSON.parse(
      await readFile(join(config.projectDir, app.directory, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    appScripts.set(app.id, manifest.scripts ?? {});
  }
  const rootManifest = JSON.parse(
    await readFile(join(config.projectDir, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  const rootScripts = rootManifest.scripts ?? {};

  const isConvex = backend === "convex";
  const isBackendSelf = backend === "self";
  const runCmd =
    packageManager === "npm" ? "npm run" : packageManager === "pnpm" ? "pnpm run" : "bun run";
  const cdCmd = `cd ${relativePath}`;
  const hasHusky = addons?.includes("husky");
  const hasLefthook = addons?.includes("lefthook");
  const hasVitePlus = addons?.includes("vite-plus");
  const hasVitePlusNativeHooks = hasVitePlus && !hasHusky && !hasLefthook;
  const hasGitHooksOrLinting =
    addons?.includes("husky") ||
    addons?.includes("biome") ||
    addons?.includes("lefthook") ||
    addons?.includes("oxlint") ||
    hasVitePlus;

  const databaseInstructions =
    !isConvex && database !== "none"
      ? await getDatabaseInstructions(
          database,
          orm,
          runCmd,
          runtime,
          dbSetup,
          webDeploy,
          serverDeploy,
          backend,
          dbSetupOptions,
        )
      : "";

  const tauriInstructions = addons?.includes("tauri")
    ? webApplications
        .filter((app) => appScripts.get(app.id)?.["desktop:dev"])
        .map((app) => getTauriInstructions(runCmd, app.stack.frontend ?? [], app.directory))
        .join("\n")
    : "";
  const electrobunInstructions =
    addons?.includes("electrobun") && rootScripts["build:desktop"]
      ? getElectrobunInstructions(
          runCmd,
          frontend,
          webApplications.map((app) => app.directory),
        )
      : "";
  const huskyInstructions = hasHusky ? getHuskyInstructions(runCmd) : "";
  const lefthookInstructions = hasLefthook ? getLefthookInstructions(packageManager) : "";
  const vitePlusNativeHooksInstructions = hasVitePlusNativeHooks
    ? getVitePlusNativeHooksInstructions(runCmd)
    : "";
  const lintingInstructions = hasGitHooksOrLinting ? getLintingInstructions(runCmd) : "";
  const nativeInstructions = nativeApplications
    .map((app) => {
      const owner = applications.find((candidate) => candidate.id === app.bindings.backend);
      return getNativeInstructions(app, owner, runCmd);
    })
    .join("\n");
  const pwaInstructions =
    addons?.includes("pwa") && frontend?.includes("react-router") ? getPwaInstructions() : "";
  const starlightInstructions = applications
    .filter((app) => app.roles.includes("docs"))
    .map((app) => getStarlightInstructions(runCmd, app.directory))
    .join("\n");
  const clerkInstructions =
    config.auth === "clerk"
      ? getClerkInstructions(applications.filter((app) => app.scope === "product"))
      : "";
  const alchemyDeployInstructions = getWorkspaceDeployInstructions(
    runCmd,
    config,
    applications,
    rootScripts,
  );

  const hasWeb = frontend?.some((f) => (webFrontends as readonly string[]).includes(f));
  const hasNative =
    frontend?.includes("native-bare") ||
    frontend?.includes("native-uniwind") ||
    frontend?.includes("native-unistyles");

  const webOrigins = webApplications.flatMap((app) => (app.origin ? [app.origin] : []));

  const betterAuthConvexInstructions =
    isConvex && config.auth === "better-auth"
      ? getBetterAuthConvexInstructions(webOrigins, backendRoot, packageManager, runCmd)
      : "";

  const bunWebNativeWarning =
    packageManager === "bun" && hasNative && hasWeb ? getBunWebNativeWarning() : "";
  const noOrmWarning = !isConvex && database !== "none" && orm === "none" ? getNoOrmWarning() : "";

  let output = `${pc.cyan("1.")} ${cdCmd}\n`;
  let stepCounter = 2;

  if (!depsInstalled) {
    output += `${pc.cyan(`${stepCounter++}.`)} ${packageManager} install\n`;
  }

  if (database === "sqlite" && dbSetup !== "d1") {
    output += `${pc.cyan(`${stepCounter++}.`)} ${runCmd} db:local\n${pc.dim(
      "   (optional - starts local SQLite database)",
    )}\n`;
  }

  const hasAlchemyD1 =
    dbSetup === "d1" &&
    (serverDeploy === "cloudflare" || (isBackendSelf && webDeploy === "cloudflare"));
  const hasWranglerLocalD1 = getLocalD1Owner(config) === "wrangler";

  if (orm === "prisma" && !hasAlchemyD1) {
    output += `${pc.cyan(`${stepCounter++}.`)} ${runCmd} db:generate\n`;
  }

  if (hasAlchemyD1 && orm !== "none") {
    output += `${pc.cyan(`${stepCounter++}.`)} ${runCmd} db:generate\n`;
    if (orm === "prisma") {
      output += `${pc.cyan(`${stepCounter++}.`)} ${runCmd} db:migrate\n`;
    }
    if (hasWranglerLocalD1) {
      output += `${pc.cyan(`${stepCounter++}.`)} ${runCmd} db:migrate:local\n`;
    }
  }

  if (isConvex) {
    output += `${pc.cyan(`${stepCounter++}.`)} ${runCmd} dev:setup\n${pc.dim(
      "   (this will guide you through Convex project setup)",
    )}\n`;

    if (backendRoot)
      output += `${pc.cyan(`${stepCounter++}.`)} Copy public Convex connection variables from\n${pc.white(
        `   ${backendRoot}/.env.local`,
      )} to each client app's .env listed in applications.json (never copy backend secrets)\n`;
    output += `${pc.cyan(`${stepCounter++}.`)} ${runCmd} dev\n\n`;
  } else if (isBackendSelf) {
    output += `${pc.cyan(`${stepCounter++}.`)} ${runCmd} dev\n`;
  } else {
    if (runtime !== "workers") {
      output += `${pc.cyan(`${stepCounter++}.`)} ${runCmd} dev\n`;
    }

    if (runtime === "workers") {
      output += `${pc.cyan(`${stepCounter++}.`)} ${runCmd} dev\n`;
    }
  }

  if (applications.length > 0) {
    const localServices: Array<{ label: string; url: string }> = [];
    const localDevelopmentNote =
      !hasWeb && !hasNative ? "Backend-only app — no frontend selected" : "";
    for (const app of applications) {
      if (
        !app.origin ||
        app.stack.backend === "convex" ||
        app.stack.frontend?.some((value) => value.startsWith("native-"))
      )
        continue;
      if (
        !app.roles.some(
          (role) =>
            role === "backend" || role === "web-frontend" || role === "admin" || role === "docs",
        )
      )
        continue;
      localServices.push({ label: app.id, url: app.origin });
      if (app.roles.includes("backend") && app.stack.api === "orpc") {
        const framework = app.stack.frontend ?? [];
        const rpcPath =
          app.stack.backend === "self"
            ? framework.some((value) => value === "next" || value === "tanstack-start")
              ? "/api/rpc"
              : "/rpc"
            : "";
        localServices.push({
          label: `${app.id} API reference`,
          url: `${app.origin}${rpcPath}/api-reference`,
        });
      }
    }

    output += `\n${pc.bold("Local development")}\n`;
    if (localDevelopmentNote) {
      output += `${pc.dim(localDevelopmentNote)}\n`;
    }

    if (localServices.length > 0) {
      const labelWidth = Math.max(...localServices.map(({ label }) => label.length));
      for (const { label, url } of localServices) {
        output += `${pc.dim(label.padEnd(labelWidth))}  ${pc.cyan(url)}\n`;
      }
    }
    output += `\n${pc.dim("Application roles, bindings and directories: applications.json")}\n`;
    for (const app of applications) {
      const scripts = appScripts.get(app.id)!;
      const command = rootScripts[`dev:${app.id}`]
        ? `${runCmd} dev:${app.id}`
        : scripts.dev
          ? `cd ${app.directory} && ${runCmd} dev`
          : undefined;
      if (command) output += `${pc.dim(app.id)}  ${command}\n`;
    }
  }

  if (nativeInstructions) output += `\n${nativeInstructions.trim()}\n`;
  if (databaseInstructions) output += `\n${databaseInstructions.trim()}\n`;
  if (tauriInstructions) output += `\n${tauriInstructions.trim()}\n`;
  if (electrobunInstructions) output += `\n${electrobunInstructions.trim()}\n`;
  if (huskyInstructions) output += `\n${huskyInstructions.trim()}\n`;
  if (lefthookInstructions) output += `\n${lefthookInstructions.trim()}\n`;
  if (vitePlusNativeHooksInstructions) output += `\n${vitePlusNativeHooksInstructions.trim()}\n`;
  if (lintingInstructions) output += `\n${lintingInstructions.trim()}\n`;
  if (pwaInstructions) output += `\n${pwaInstructions.trim()}\n`;
  if (starlightInstructions) output += `\n${starlightInstructions.trim()}\n`;
  if (clerkInstructions) output += `\n${clerkInstructions.trim()}\n`;
  if (betterAuthConvexInstructions) output += `\n${betterAuthConvexInstructions.trim()}\n`;
  // Deploy steps come last so env sync happens after auth/payment keys exist
  if (alchemyDeployInstructions) output += `\n${alchemyDeployInstructions.trim()}\n`;

  if (noOrmWarning) output += `\n${noOrmWarning.trim()}\n`;
  if (bunWebNativeWarning) output += `\n${bunWebNativeWarning.trim()}\n`;

  const sponsorsResult = await fetchSponsorsQuietly();
  const specialSponsorsSection = sponsorsResult.isOk()
    ? formatPostInstallSpecialSponsorsSection(sponsorsResult.value)
    : "";

  log.message([], { spacing: 1 });
  box(output.trimEnd(), pc.bold("Next steps"), {
    contentPadding: 2,
    formatBorder: pc.dim,
    rounded: true,
    width: "auto",
  });

  if (specialSponsorsSection) {
    cliLog.message(specialSponsorsSection);
  }

  cliLog.message(
    `${pc.bold("Like xstack?")} ${pc.dim("Star the project on GitHub")}\n${pc.cyan(
      "https://github.com/ziyu/xstack",
    )}`,
  );
}

function getNativeInstructions(
  app: WorkspaceApplication,
  owner: WorkspaceApplication | undefined,
  runCmd: string,
) {
  const lines = [
    `${pc.bold(`Native app (${app.id}):`)}\n   cd ${app.directory} and run ${runCmd} android or ${runCmd} ios`,
  ];
  if (owner) {
    const isConvex = owner.stack.backend === "convex";
    const envVar = isConvex ? "EXPO_PUBLIC_CONVEX_URL" : "EXPO_PUBLIC_SERVER_URL";
    const origin = owner.origin ? new URL(owner.origin) : undefined;
    const exampleUrl = isConvex
      ? "https://example.convex.cloud"
      : origin
        ? `${origin.protocol}//<YOUR_LOCAL_IP>${origin.port ? `:${origin.port}` : ""}`
        : "the reachable backend URL from applications.json";
    lines.push(
      `${pc.yellow("NOTE:")} For device connectivity, set ${envVar}=${exampleUrl} in ${app.directory}/.env (backend: ${owner.directory}). Use your local IP address instead of localhost for local device access.`,
    );
  }
  if (app.stack.frontend?.includes("native-unistyles"))
    lines.push(`${pc.yellow("NOTE:")} Unistyles requires a development build.`);
  return lines.join("\n");
}

function getHuskyInstructions(runCmd: string) {
  return `${pc.bold("Git hooks with Husky:")}\n${pc.cyan(
    "•",
  )} Initialize hooks: ${`${runCmd} prepare`}\n`;
}

function getLintingInstructions(runCmd: string) {
  return `${pc.bold("Linting and formatting:")}\n${pc.cyan(
    "•",
  )} Run checks: ${`${runCmd} check`}\n`;
}

function getLefthookInstructions(packageManager: string) {
  const cmd = packageManager === "npm" ? "npx" : packageManager;
  return `${pc.bold("Git hooks with Lefthook:")}\n${pc.cyan(
    "•",
  )} Install hooks: ${cmd} lefthook install\n`;
}

function getVitePlusNativeHooksInstructions(runCmd: string) {
  return `${pc.bold("Vite+ native Git hooks:")}\n${pc.cyan(
    "•",
  )} Optional hook setup: ${`${runCmd} hooks:setup`}\n${pc.dim(
    "   (runs vp config; hooks install into .vite-hooks and use vp staged)",
  )}\n`;
}

async function getDatabaseInstructions(
  database: Database,
  orm: ORM,
  runCmd: string,
  _runtime: Runtime,
  dbSetup: DatabaseSetup,
  webDeploy: WebDeploy,
  serverDeploy: ServerDeploy,
  backend: Backend,
  dbSetupOptions: DbSetupOptions | undefined,
) {
  const notes: string[] = [];
  const commands: Array<{ label: string; command: string }> = [];
  const isD1Alchemy =
    dbSetup === "d1" &&
    (serverDeploy === "cloudflare" || (backend === "self" && webDeploy === "cloudflare"));
  const isAlchemyManagedDatabase = usesAlchemyManagedDatabase({
    backend,
    dbSetup,
    webDeploy,
    serverDeploy,
    dbSetupOptions,
  });

  if (dbSetup === "docker") {
    const dockerStatus = await getDockerStatus(database);

    if (dockerStatus.message) {
      notes.push(dockerStatus.message);
    }
  }

  if (isAlchemyManagedDatabase) {
    const provider =
      dbSetup === "prisma-postgres"
        ? "Prisma Postgres"
        : dbSetup === "planetscale"
          ? "PlanetScale"
          : "Neon";
    notes.push(
      `${pc.cyan("INFO:")} Alchemy provisions ${provider}, injects its connection credentials, and applies checked-in migrations during deploy.`,
    );
    if (dbSetup === "planetscale") {
      notes.push(
        `${pc.yellow("NOTE:")} The generated PlanetScale database uses the PS_DEV size, which may incur usage charges.`,
      );
    }
  }

  if (dbSetup === "planetscale" && !isAlchemyManagedDatabase) {
    if (database === "mysql" && orm === "drizzle") {
      notes.push(
        `${pc.yellow("NOTE:")} Enable foreign key constraints in PlanetScale database settings`,
      );
    }
    if (database === "mysql" && orm === "prisma") {
      notes.push(
        `${pc.yellow(
          "NOTE:",
        )} How to handle Prisma migrations with PlanetScale:\n   https://github.com/prisma/prisma/issues/7292`,
      );
    }
  }

  if (dbSetup === "turso" && orm === "prisma") {
    notes.push(
      `${pc.yellow(
        "NOTE:",
      )} Follow Turso's Prisma guide for migrations via the Turso CLI:\n   https://docs.turso.tech/sdk/ts/orm/prisma`,
    );
  }

  if (orm === "prisma") {
    if (database === "mongodb" && dbSetup === "docker") {
      notes.push(
        `${pc.yellow("WARNING:")} Prisma + MongoDB + Docker combination\n   may not work.`,
      );
    }
    if (dbSetup === "docker") {
      commands.push({ label: "Start database", command: `${runCmd} db:start` });
    }
    if (isAlchemyManagedDatabase) {
      commands.push({ label: "Generate client", command: `${runCmd} db:generate` });
    } else if (!isD1Alchemy) {
      commands.push({ label: "Generate client", command: `${runCmd} db:generate` });
      commands.push({ label: "Apply schema", command: `${runCmd} db:push` });
    }
    if (!isD1Alchemy && !isAlchemyManagedDatabase) {
      commands.push({ label: "Open studio", command: `${runCmd} db:studio` });
    }
  } else if (orm === "drizzle") {
    if (dbSetup === "docker") {
      commands.push({ label: "Start database", command: `${runCmd} db:start` });
    }
    if (isAlchemyManagedDatabase) {
      commands.push({ label: "Generate migrations", command: `${runCmd} db:generate` });
    } else if (!isD1Alchemy) {
      commands.push({ label: "Apply schema", command: `${runCmd} db:push` });
    }
    if (!isD1Alchemy && !isAlchemyManagedDatabase) {
      commands.push({ label: "Open studio", command: `${runCmd} db:studio` });
    }
  } else if (orm === "mongoose") {
    if (dbSetup === "docker") {
      commands.push({ label: "Start database", command: `${runCmd} db:start` });
    }
  } else if (orm === "none") {
    notes.push(`${pc.yellow("NOTE:")} Manual database schema setup required.`);
  }

  if (notes.length === 0 && commands.length === 0) {
    return "";
  }

  const sections = [pc.bold("Database")];
  if (notes.length > 0) {
    sections.push(notes.join("\n"));
  }
  if (commands.length > 0) {
    const labelWidth = Math.max(...commands.map(({ label }) => label.length));
    const commandRows = commands.map(
      ({ label, command }) => `${pc.dim(label.padEnd(labelWidth))}  ${pc.cyan(command)}`,
    );
    sections.push(commandRows.join("\n"));
  }

  return sections.join("\n");
}

function getTauriInstructions(runCmd: string, frontend: Frontend[], directory: string) {
  const staticBuildNote = getDesktopStaticBuildNote(frontend);

  return `\n${pc.bold(`Desktop app with Tauri (${directory}):`)}\n${pc.cyan(
    "•",
  )} Start desktop app: ${`cd ${directory} && ${runCmd} desktop:dev`}\n${pc.cyan(
    "•",
  )} Build desktop app: ${`cd ${directory} && ${runCmd} desktop:build`}\n${pc.yellow(
    "NOTE:",
  )} Tauri requires Rust and platform-specific dependencies.\n   See: ${"https://v2.tauri.app/start/prerequisites/"}${
    staticBuildNote ? `\n${staticBuildNote}` : ""
  }`;
}

function getElectrobunInstructions(runCmd: string, frontend: Frontend[], directories: string[]) {
  const staticBuildNote = getDesktopStaticBuildNote(frontend);

  return `\n${pc.bold("Desktop app with Electrobun:")}\n${pc.cyan(
    "•",
  )} Start desktop app with HMR: ${`${runCmd} dev:desktop`}\n${pc.cyan(
    "•",
  )} Build stable desktop app (DMG/App): ${`${runCmd} build:desktop`}\n${pc.cyan(
    "•",
  )} Build canary desktop app: ${`${runCmd} build:desktop:canary`}\n${pc.yellow(
    "NOTE:",
  )} Electrobun wraps your web frontend in a desktop shell.\n   The first desktop command downloads Hutch and the Electrobun toolchain.\n   Packaged builds bake API URLs from their bound web app's .env (${directories.join(", ")}); use reachable backend URLs.\n   See: ${"https://framework.blackboard.sh/electrobun/"}${
    staticBuildNote ? `\n${staticBuildNote}` : ""
  }`;
}

function getPwaInstructions() {
  return `\n${pc.bold("PWA with React Router:")}\n${pc.yellow(
    "NOTE:",
  )} Verify PWA behavior with a production build on HTTPS or localhost.\n   Offline navigation shows a precached fallback page.\n   Server-rendered pages require a connection.`;
}

function getStarlightInstructions(runCmd: string, directory: string) {
  return `\n${pc.bold(`Documentation (${directory}):`)}\n${pc.cyan(
    "•",
  )} Start docs site: ${`cd ${directory} && ${runCmd} dev`}\n${pc.cyan(
    "•",
  )} Build docs site: ${`cd ${directory} && ${runCmd} build`}`;
}

function getNoOrmWarning() {
  return `\n${pc.yellow(
    "WARNING:",
  )} Database selected without an ORM. Features requiring\n   database access (e.g., examples, auth) need manual setup.`;
}

function getBunWebNativeWarning() {
  return `\n${pc.yellow(
    "WARNING:",
  )} 'bun' might cause issues with web + native apps in a monorepo.\n   Use 'pnpm' if problems arise.`;
}

function getClerkQuickstartUrl(frontend: Frontend[]) {
  if (frontend.includes("next")) return "https://clerk.com/docs/nextjs/getting-started/quickstart";
  if (frontend.includes("react-router")) {
    return "https://clerk.com/docs/react-router/getting-started/quickstart";
  }
  if (frontend.includes("tanstack-start")) {
    return "https://clerk.com/docs/tanstack-react-start/getting-started/quickstart";
  }
  if (frontend.includes("tanstack-router")) {
    return "https://clerk.com/docs/react/getting-started/quickstart";
  }
  if (
    frontend.includes("native-bare") ||
    frontend.includes("native-uniwind") ||
    frontend.includes("native-unistyles")
  ) {
    return "https://clerk.com/docs/expo/getting-started/quickstart";
  }

  return "https://clerk.com/docs";
}

function getClerkInstructions(applications: WorkspaceApplication[]) {
  const lines = [pc.bold("Clerk Authentication Setup:")];
  for (const app of applications) {
    const frontend = app.stack.frontend ?? [];
    const envPath = `${app.directory}/.env`;
    if (frontend.length)
      lines.push(`${pc.cyan("•")} ${app.id}: ${pc.underline(getClerkQuickstartUrl(frontend))}`);
    const publicKey = frontend.includes("next")
      ? "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"
      : frontend.some((value) => value.startsWith("native-"))
        ? "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY"
        : frontend.some((value) =>
              ["react-router", "tanstack-router", "tanstack-start"].includes(value),
            )
          ? "VITE_CLERK_PUBLISHABLE_KEY"
          : undefined;
    if (publicKey) lines.push(`${pc.cyan("•")} Set ${publicKey} in ${envPath}`);
    if (frontend.some((value) => ["next", "react-router", "tanstack-start"].includes(value))) {
      lines.push(`${pc.cyan("•")} Set CLERK_SECRET_KEY in ${envPath} for Clerk server middleware`);
    }
    if (!app.roles.includes("backend")) continue;
    const backend = app.stack.backend;
    if (backend === "convex") {
      lines.push(`${pc.cyan("•")} Set CLERK_JWT_ISSUER_DOMAIN in Convex Dashboard`);
      continue;
    }
    lines.push(`${pc.cyan("•")} Set CLERK_SECRET_KEY in ${envPath} for server-side Clerk auth`);
    if (
      backend &&
      (["express", "fastify"].includes(backend) ||
        (app.stack.api !== "none" && ["self", "hono", "elysia"].includes(backend)))
    ) {
      lines.push(
        `${pc.cyan("•")} Set CLERK_PUBLISHABLE_KEY in ${envPath} for server-side Clerk request verification`,
      );
    }
  }
  return lines.join("\n");
}

function getBetterAuthConvexInstructions(
  webOrigins: string[],
  backendRoot: string | undefined,
  packageManager: string,
  runCmd: string,
) {
  if (!backendRoot) return "";
  const cmd = packageManager === "npm" ? "npx" : packageManager;
  return (
    `${pc.bold("Better Auth + Convex Setup:")}\n` +
    `${pc.cyan("•")} Configure the Convex deployment before setting env vars:\n` +
    `${pc.white(`   ${runCmd} dev:setup`)}\n` +
    `${pc.cyan("•")} Set environment variables from ${pc.white(backendRoot)}:\n` +
    `${pc.white(`   cd ${backendRoot}`)}\n` +
    `${pc.white(`   ${cmd} convex env set BETTER_AUTH_SECRET=$(openssl rand -base64 32)`)}\n` +
    (webOrigins.length === 1
      ? `${pc.white(`   ${cmd} convex env set SITE_URL ${webOrigins[0]}`)}\n`
      : webOrigins.length > 1
        ? `${pc.cyan("•")} Configure SITE_URL for the intended auth client and allow every client origin in the backend auth configuration: ${webOrigins.join(", ")}\n`
        : "")
  );
}

function getWorkspaceDeployInstructions(
  runCmd: string,
  config: RenderConfig,
  applications: WorkspaceApplication[],
  scripts: Record<string, string>,
) {
  const commands = Object.keys(scripts).filter((name) =>
    /^(deploy(?::|$)|destroy(?::|$)|env:(?:.*:)?(?:preview|production)$|docker:|dev:.*:vercel$|dev:vercel$)/.test(
      name,
    ),
  );
  if (!commands.length) return "";
  const lines = [
    pc.bold("Deployment:"),
    `${pc.cyan("•")} See README.md for per-app deployment details and applications.json for application ownership.`,
  ];
  if (
    isAlchemyDeployTarget(config.webDeploy) ||
    isAlchemyDeployTarget(config.serverDeploy) ||
    config.addons.includes("axiom")
  ) {
    const exec =
      config.packageManager === "npm"
        ? "npx"
        : config.packageManager === "pnpm"
          ? "pnpm exec"
          : "bunx";
    lines.push(
      `${pc.cyan("•")} Configure provider accounts: cd packages/infra && ${exec} alchemy profile edit`,
      `${pc.cyan("•")} Alchemy deploy/destroy operates the shared application and database stack. For production, run alchemy deploy --stage production from packages/infra.`,
    );
    const owner = applications.find((app) => app.roles.includes("backend"));
    if (owner && owner.stack.backend !== "self" && isAlchemyDeployTarget(config.serverDeploy))
      lines.push(
        `${pc.cyan("•")} After the first deploy, set CORS_ORIGIN in ${owner.directory}/.env to all bound web clients' deployed origins (comma-separated), then deploy again.`,
      );
    if (
      owner &&
      config.auth === "better-auth" &&
      (config.webDeploy === "prisma" || config.serverDeploy === "prisma")
    )
      lines.push(
        `${pc.cyan("•")} Set BETTER_AUTH_URL in ${owner.directory}/.env to the returned backend URL and deploy again.`,
      );
    if (config.addons.includes("axiom"))
      lines.push(
        `${pc.cyan("•")} For Axiom on Vercel, link targets before deploying the preview/production infrastructure stage. Deployed Docker images need AXIOM_API_KEY, AXIOM_DATASET and AXIOM_EDGE_URL supplied through platform secrets.`,
      );
  }
  if (config.webDeploy === "vercel" || config.serverDeploy === "vercel")
    lines.push(
      `${pc.cyan("•")} Link each Vercel target, then sync its environment before its first deployment; local .env files are not uploaded automatically.`,
    );
  if (config.webDeploy === "docker" || config.serverDeploy === "docker")
    lines.push(
      `${pc.cyan("•")} Docker Compose configuration: docker-compose.yml.`,
      `${pc.cyan("•")} Guide: https://www.xstack.dev/docs/guides/docker`,
    );
  lines.push(...commands.map((name) => `${pc.cyan("•")} ${runCmd} ${name}`));
  return lines.join("\n");
}
