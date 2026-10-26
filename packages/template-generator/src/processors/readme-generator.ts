import {
  getLocalD1Owner,
  isAlchemyDeployTarget,
  usesAlchemyManagedDatabase,
  type ProjectConfig,
} from "@xstack/types";

import { appOutputPath } from "../contributions/context";
import type { VirtualFileSystem } from "../core/virtual-fs";
import { moduleReadmeSection } from "../modules/pipeline";
import type { RenderConfig, WorkspaceApplicationContext } from "../types";
import { getDbScriptSupport } from "../utils/db-scripts";
import { isDatabaseConsumedByDocker } from "../utils/docker-database";

function getDesktopStaticBuildNote(frontend: ProjectConfig["frontend"]): string {
  const labels = {
    "tanstack-start": "TanStack Start",
    next: "Next.js",
    nuxt: "Nuxt",
    svelte: "SvelteKit",
    astro: "Astro",
  } as const satisfies Partial<Record<ProjectConfig["frontend"][number], string>>;
  const selected = frontend.flatMap((value) => (hasOwnKey(labels, value) ? [labels[value]] : []));
  return selected.length
    ? `Desktop builds package static web assets. ${selected.join(", ")} require a static/export build configuration before desktop packaging will work.`
    : "";
}

function getClerkQuickstartUrl(frontend: ProjectConfig["frontend"]): string {
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

function guidanceApplications(config: RenderConfig): WorkspaceApplicationContext[] {
  if (config.application) return config.application.workspaceApplications;
  const applications: WorkspaceApplicationContext[] = [];
  const add = (
    kind: "web" | "native" | "server",
    frontend: ProjectConfig["frontend"],
    roles: string[],
  ) => {
    const directory =
      kind === "server" && config.backend === "convex"
        ? "packages/backend"
        : appOutputPath(config, kind);
    const port =
      kind === "native"
        ? 8081
        : kind === "server"
          ? 3000
          : frontend.includes("astro")
            ? 4321
            : frontend.some((value) => value === "svelte" || value === "react-router")
              ? 5173
              : 3001;
    applications.push({
      id: directory.split("/").at(-1)!,
      type: frontend[0] ?? config.backend,
      directory,
      roles,
      port,
      origin: `http://localhost:${port}`,
      bindings: {},
      frontend,
      backend: roles.includes("backend") ? config.backend : "none",
      runtime: config.runtime,
      api: config.api,
      webDeploy: config.webDeploy,
      serverDeploy: config.serverDeploy,
    });
  };
  const web = config.frontend.filter((value) => value !== "none" && !value.startsWith("native-"));
  const native = config.frontend.filter((value) => value.startsWith("native-"));
  if (web.length)
    add("web", web, config.backend === "self" ? ["web-frontend", "backend"] : ["web-frontend"]);
  if (native.length) add("native", native, ["native"]);
  if (config.backend !== "none" && config.backend !== "self") add("server", [], ["backend"]);
  return applications;
}

function getClerkSetupLines(config: RenderConfig): string[] {
  const lines: string[] = [];
  for (const app of guidanceApplications(config)) {
    if (
      config.application &&
      !app.roles.some(
        (role) => role === "backend" || role === "web-frontend" || role === "admin",
      ) &&
      !app.bindings.backend
    )
      continue;
    const envPath = `${app.directory}/.env`;
    const frontend = app.frontend;
    const publicKey = frontend.includes("next")
      ? "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"
      : frontend.some((value) => value.startsWith("native-"))
        ? "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY"
        : frontend.some((value) =>
              ["react-router", "tanstack-router", "tanstack-start"].includes(value),
            )
          ? "VITE_CLERK_PUBLISHABLE_KEY"
          : undefined;
    if (publicKey) lines.push(`- Set \`${publicKey}\` in \`${envPath}\``);
    if (frontend.some((value) => ["next", "react-router", "tanstack-start"].includes(value))) {
      lines.push(`- Set \`CLERK_SECRET_KEY\` in \`${envPath}\` for Clerk server middleware`);
    }
    if (!app.roles.includes("backend")) continue;
    if (app.backend === "convex") {
      lines.push("- Set `CLERK_JWT_ISSUER_DOMAIN` in Convex Dashboard");
      continue;
    }
    lines.push(`- Set \`CLERK_SECRET_KEY\` in \`${envPath}\` for server-side Clerk auth`);
    if (
      ["express", "fastify"].includes(app.backend) ||
      (app.api !== "none" && ["self", "hono", "elysia"].includes(app.backend))
    ) {
      lines.push(
        `- Set \`CLERK_PUBLISHABLE_KEY\` in \`${envPath}\` for server-side Clerk request verification`,
      );
    }
  }
  return lines;
}

function hasNativeFrontend(frontend: ProjectConfig["frontend"]): boolean {
  return frontend.some((value) =>
    ["native-bare", "native-uniwind", "native-unistyles"].includes(value),
  );
}

function hasWebFrontend(frontend: ProjectConfig["frontend"]): boolean {
  return frontend.some((value) =>
    [
      "tanstack-router",
      "react-router",
      "tanstack-start",
      "next",
      "svelte",
      "nuxt",
      "solid",
      "astro",
    ].includes(value),
  );
}

export function processReadme(vfs: VirtualFileSystem, config: RenderConfig): void {
  const applications = guidanceApplications(config);
  const frontend = [...new Set(applications.flatMap((app) => app.frontend))];
  let content = generateReadmeContent({ ...config, frontend }, vfs) + moduleReadmeSection(config);
  if (
    vfs.readJson<{ scripts?: Record<string, string> }>("package.json")?.scripts?.["auth:generate"]
  ) {
    content += `\n## Better Auth Schema Generation\n\nAfter changing auth plugins or schema options, run \`${config.packageManager} run auth:generate\` from the project root. The script runs the Better Auth CLI through \`varlock run\` from the owning app directory, loading the auth instance from \`src/services.ts\`. Review the schema changes, then use your ORM's migration workflow to apply them.\n`;
  }
  vfs.writeFile("README.md", content);
}

function generateReadmeContent(options: RenderConfig, vfs: VirtualFileSystem): string {
  const {
    projectName,
    packageManager,
    database,
    auth,
    addons = [],
    orm = "drizzle",
    runtime = "bun",
    frontend = ["tanstack-router"],
    backend = "hono",
    api = "trpc",
    dbSetup,
    webDeploy,
    serverDeploy,
  } = options;

  const isConvex = backend === "convex";
  const hasReactRouter = frontend.includes("react-router");
  const hasReactWeb = frontend.some((f) =>
    ["tanstack-router", "react-router", "tanstack-start", "next"].includes(f),
  );
  const packageManagerRunCmd = `${packageManager} run`;

  const stackDescription = generateStackDescription(frontend, backend, api, isConvex);

  return `# ${projectName}

This project was created with [xstack](https://github.com/ziyu/xstack), a modern TypeScript stack${
    stackDescription ? ` that combines ${stackDescription}` : ""
  }.

## Features

${generateFeaturesList(database, auth, addons, orm, runtime, frontend, backend, api, dbSetup)}

## Getting Started

First, install the dependencies:

\`\`\`bash
${packageManager} install
\`\`\`
${
  isConvex
    ? `
## Convex Setup

This project uses Convex as a backend. You'll need to set up Convex before running the app:

\`\`\`bash
${packageManagerRunCmd} dev:setup
\`\`\`

Follow the prompts to create a new Convex project and connect it to your application.

Copy the public Convex connection variables from \`${guidanceApplications(options).find((app) => app.roles.includes("backend"))?.directory}/.env.local\` to each client app's \`.env\`; never copy backend secrets to clients.
${
  auth === "clerk"
    ? `
### Clerk Authentication Setup

- Follow the guide: [Convex + Clerk](https://docs.convex.dev/auth/clerk)
${getClerkSetupLines(options).join("\n")}`
    : ""
}`
    : generateDatabaseSetup(options, packageManagerRunCmd)
}
${
  !isConvex && auth === "clerk"
    ? `
## Clerk Authentication Setup

${guidanceApplications(options)
  .filter((app) => app.frontend.length > 0)
  .map((app) => `- ${app.id}: [Clerk Quickstart](${getClerkQuickstartUrl(app.frontend)})`)
  .join("\n")}
${getClerkSetupLines(options).join("\n")}`
    : ""
}

Then, run the development server:

\`\`\`bash
${packageManagerRunCmd} dev
\`\`\`

${generateRunningInstructions(options)}
${generateReactUiSection(hasReactWeb, projectName, options)}
## Environment Configuration

Each app owns its environment schema in \`.env.schema\`. Varlock generates \`src/env.ts\` during installation; run \`${packageManagerRunCmd} env:generate\` after changing a schema. Commit schemas, and keep secrets in ignored env files or your deployment platform.

Import the generated \`ENV\` accessor in application code. Shared database and auth packages receive configuration or initialized clients from the application. See [Varlock's monorepo guide](https://varlock.dev/guides/monorepos/).

${webDeploy === "cloudflare" || serverDeploy === "cloudflare" ? "For Cloudflare, Alchemy loads and validates deployment inputs with `varlock/auto-load` in its Node/Bun deployment process. Worker code reads native bindings; web clients use the framework's public env API through `src/env.public.ts` where needed. Alchemy supplies resource URLs and managed database credentials. In-Worker Varlock protections are deferred until an official Alchemy integration is available; see [the non-Wrangler deployment guidance](https://varlock.dev/integrations/cloudflare/#non-wrangler-deploy-tools-alchemy-sst-pulumi).\n" : ""}

Bun's automatic env loading is disabled in \`bunfig.toml\`; the framework integration or server bootstrap loads Varlock. Node deployments must include Varlock and its dependencies alongside the app schema.

Run standalone Node/Bun tools that use Varlock from the owning app directory so they load that app's schema and env files. \`env:generate\` only generates TypeScript files; it does not initialize environment values in a subsequent command.

${
  addons.includes("pwa") && hasReactRouter
    ? "\n## PWA Support with React Router\n\nVerify PWA behavior with a production build on HTTPS or localhost. Offline navigation shows a precached fallback page; server-rendered pages require a connection. Authenticated HTML and API responses are not runtime-cached.\n"
    : ""
}
${
  options.application
    ? generateWorkspaceDeployment(options, vfs)
    : generateDeploymentCommands(
        packageManagerRunCmd,
        webDeploy,
        serverDeploy,
        backend,
        auth,
        frontend,
        database,
        dbSetup,
        addons,
        appOutputPath(options, "server"),
      )
}
${generateGitHooksSection(packageManagerRunCmd, addons)}

## Project Structure

\`\`\`
${generateProjectStructure(options)}
\`\`\`

## Available Scripts

${generateScriptsList(packageManagerRunCmd, options, vfs)}
`;
}

function hasOwnKey<T extends object>(object: T, key: PropertyKey): key is keyof T {
  return Object.hasOwn(object, key);
}

function generateStackDescription(
  frontend: ProjectConfig["frontend"],
  backend: ProjectConfig["backend"],
  api: ProjectConfig["api"],
  isConvex: boolean,
): string {
  const parts: string[] = [];

  const frontendMap = {
    "tanstack-router": "React, TanStack Router",
    "react-router": "React, React Router",
    next: "Next.js",
    "tanstack-start": "React, TanStack Start",
    svelte: "SvelteKit",
    nuxt: "Nuxt",
    solid: "Solid",
    astro: "Astro",
    "native-bare": "React Native, Expo",
    "native-uniwind": "React Native, Expo",
    "native-unistyles": "React Native, Expo",
  } satisfies Record<string, string>;

  for (const fe of frontend) {
    if (hasOwnKey(frontendMap, fe)) {
      parts.push(frontendMap[fe]);
    }
  }

  if (backend !== "none") {
    parts.push((backend[0]?.toUpperCase() ?? "") + backend.slice(1));
  }

  if (!isConvex && api !== "none") {
    parts.push(api.toUpperCase());
  }

  return parts.length > 0 ? `${parts.join(", ")}, and more` : "";
}

/** Describe every selected application, not a preferred client. */
function generateRunningInstructions(config: RenderConfig): string {
  return guidanceApplications(config)
    .map((app) => {
      if (hasNativeFrontend(app.frontend)) {
        return `- **${app.id}**: from \`${app.directory}\`, run \`${config.packageManager} run ios\` or \`${config.packageManager} run android\` to build and launch the native app. See [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/).`;
      }
      if (app.backend === "convex")
        return `- **${app.id}**: connects to your configured Convex deployment.`;
      if (
        !app.roles.some((role) => role === "backend" || role === "web-frontend" || role === "admin")
      )
        return `- **${app.id}**: source in \`${app.directory}\`. Use the app's commands in Available Scripts below.`;
      return `- **${app.id}** (${app.roles.join(", ")}): [${app.origin}](${app.origin}), source in \`${app.directory}\`.`;
    })
    .join("\n");
}

function generateReactUiSection(
  hasReactWeb: boolean,
  projectName: string,
  config: RenderConfig,
): string {
  if (!hasReactWeb) return "";
  const directories = guidanceApplications(config)
    .filter((app) =>
      app.frontend.some((frontend) =>
        ["next", "tanstack-start", "tanstack-router", "react-router"].includes(frontend),
      ),
    )
    .map((app) => app.directory);

  return `
## UI Customization

React web apps in this stack share shadcn/ui primitives through \`packages/ui\`.

- Change design tokens and global styles in \`packages/ui/src/styles/globals.css\`
- Update shared primitives in \`packages/ui/src/components/*\`
- Adjust shadcn aliases or style config in \`packages/ui/components.json\` and ${directories.map((directory) => `\`${directory}/components.json\``).join(", ")}

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

\`\`\`bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
\`\`\`

Import shared components like this:

\`\`\`tsx
import { Button } from "@${projectName}/ui/components/button"
\`\`\`

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from the target app directory: ${directories.map((directory) => `\`${directory}\``).join(", ")}.
`;
}

function generateProjectStructure(config: RenderConfig): string {
  const applications = guidanceApplications(config);
  const structure = [
    `${config.projectName}/`,
    ...applications.map((app) => `├── ${app.directory}/  # ${app.type}: ${app.roles.join(", ")}`),
  ];
  structure.push(
    "├── applications.json  # Application roles, bindings, directories and local origins",
    "└── packages/          # Shared UI, configuration and selected backend modules",
  );
  return structure.join("\n");
}

function generateFeaturesList(
  database: ProjectConfig["database"],
  auth: RenderConfig["auth"],
  addons: ProjectConfig["addons"],
  orm: ProjectConfig["orm"],
  runtime: ProjectConfig["runtime"],
  frontend: ProjectConfig["frontend"],
  backend: ProjectConfig["backend"],
  api: ProjectConfig["api"],
  dbSetup: ProjectConfig["dbSetup"],
): string {
  const isConvex = backend === "convex";
  const hasNative = hasNativeFrontend(frontend);
  const hasAppWebFrontend = hasWebFrontend(frontend);
  const hasReactWeb = frontend.some((f) =>
    ["tanstack-router", "react-router", "tanstack-start", "next"].includes(f),
  );
  const usesTailwind = hasAppWebFrontend || frontend.includes("native-uniwind");

  const features = ["- **TypeScript** - For type safety and improved developer experience"];

  const frontendFeatures = {
    "tanstack-router": "- **TanStack Router** - File-based routing with full type safety",
    "react-router": "- **React Router** - Declarative routing for React",
    next: "- **Next.js** - Full-stack React framework",
    "tanstack-start": "- **TanStack Start** - SSR framework with TanStack Router",
    svelte: "- **SvelteKit** - Web framework for building Svelte apps",
    nuxt: "- **Nuxt** - The Intuitive Vue Framework",
    solid: "- **Solid** - Solid application with file-based routing and SSR",
    astro: "- **Astro** - The web framework for content-driven websites",
  } satisfies Record<string, string>;

  for (const fe of frontend) {
    if (hasOwnKey(frontendFeatures, fe)) {
      features.push(frontendFeatures[fe]);
    }
  }

  if (hasNative) {
    features.push(
      "- **React Native** - Build mobile apps using React",
      "- **Expo** - Tools for React Native development",
    );
  }

  if (usesTailwind) {
    features.push("- **TailwindCSS** - Utility-first CSS for rapid UI development");
  }

  if (hasReactWeb) {
    features.push("- **Shared UI package** - shadcn/ui primitives live in `packages/ui`");
  }

  const backendFeatures = {
    convex: "- **Convex** - Reactive backend-as-a-service platform",
    hono: "- **Hono** - Lightweight, performant server framework",
    express: "- **Express** - Fast, unopinionated web framework",
    fastify: "- **Fastify** - Fast, low-overhead web framework",
    elysia: "- **Elysia** - Type-safe, high-performance framework",
  } satisfies Record<string, string>;

  if (hasOwnKey(backendFeatures, backend)) {
    features.push(backendFeatures[backend]);
  }

  if (!isConvex && api === "trpc") {
    features.push("- **tRPC** - End-to-end type-safe APIs");
  } else if (!isConvex && api === "orpc") {
    features.push("- **oRPC** - End-to-end type-safe APIs with OpenAPI integration");
  }

  if (!isConvex && backend !== "none" && runtime !== "none") {
    const runtimeName = runtime === "bun" ? "Bun" : runtime === "node" ? "Node.js" : runtime;
    features.push(`- **${runtimeName}** - Runtime environment`);
  }

  if (database !== "none" && !isConvex) {
    const ormNames = {
      drizzle: "Drizzle",
      prisma: "Prisma",
      mongoose: "Mongoose",
    } satisfies Record<string, string>;
    const dbNames = {
      sqlite: dbSetup === "d1" ? "Cloudflare D1" : "SQLite/Turso",
      postgres: "PostgreSQL",
      mysql: "MySQL",
      mongodb: "MongoDB",
    } satisfies Record<string, string>;
    const ormName = hasOwnKey(ormNames, orm) ? ormNames[orm] : "ORM";
    const dbName = hasOwnKey(dbNames, database) ? dbNames[database] : "Database";
    features.push(`- **${ormName}** - TypeScript-first ORM`, `- **${dbName}** - Database engine`);
  }

  if (auth !== "none") {
    const authLabel = auth === "clerk" ? "Clerk" : "Better-Auth";
    features.push(`- **Authentication** - ${authLabel}`);
  }

  const addonFeatures = {
    pwa: "- **PWA** - Progressive Web App support",
    tauri: "- **Tauri** - Build native desktop applications",
    electrobun: "- **Electrobun** - Lightweight desktop shell for web frontends",
    biome: "- **Biome** - Linting and formatting",
    oxlint: "- **Oxlint** - Oxlint + Oxfmt (linting & formatting)",
    husky: "- **Husky** - Git hooks for code quality",
    starlight: "- **Starlight** - Documentation site with Astro",
    turborepo: "- **Turborepo** - Optimized monorepo build system",
    nx: "- **Nx** - Smart monorepo task orchestration and caching",
    "vite-plus":
      "- **Vite+** - Unified Vite toolchain, workspace task runner, linting, and formatting",
  } satisfies Record<string, string>;

  for (const addon of addons) {
    if (hasOwnKey(addonFeatures, addon)) {
      features.push(addonFeatures[addon]);
    }
  }

  return features.join("\n");
}

function generateDatabaseSetup(config: RenderConfig, packageManagerRunCmd: string): string {
  const { database, orm, dbSetup } = config;
  if (database === "none") return "";

  const backendRoot = appOutputPath(config, "server");
  const envPath = `${backendRoot}/.env`;
  const ormLabels = {
    drizzle: "Drizzle ORM",
    prisma: "Prisma",
    mongoose: "Mongoose",
    none: "ORM",
  } satisfies Record<ProjectConfig["orm"], string>;
  const ormDesc = orm === "none" ? "" : ` with ${ormLabels[orm] || orm}`;
  const dbSupport = getDbScriptSupport(config);
  const isD1Alchemy = dbSupport.isD1Alchemy;
  const isAlchemyManagedDatabase = usesAlchemyManagedDatabase(config);

  let setup = "## Database Setup\n\n";

  if (orm === "prisma" && !isD1Alchemy) {
    setup += `Generate the Prisma client before development, typechecking, or building, including in CI and deployment builds. Run this again after changing the Prisma schema:\n
\`\`\`bash
${packageManagerRunCmd} db:generate
\`\`\`\n\n`;
  }

  if (isAlchemyManagedDatabase) {
    const provider =
      dbSetup === "prisma-postgres"
        ? "Prisma Postgres"
        : dbSetup === "planetscale"
          ? "PlanetScale"
          : "Neon";
    const migrationWorkflow =
      orm === "prisma"
        ? `The scaffold includes an initial Prisma migration when generated models need one. Create and commit later migrations with \`${packageManagerRunCmd} db:migrate\`; deployment applies checked-in migrations with \`prisma migrate deploy\`.`
        : `Generate and commit migration SQL with \`${packageManagerRunCmd} db:generate\`. Deployment applies checked-in migrations after provisioning the database.`;
    const costNote =
      dbSetup === "planetscale"
        ? "\n\nThe generated PlanetScale resource uses the `PS_DEV` size. PlanetScale may charge for this database; adjust `clusterSize` in `packages/infra/alchemy.run.ts` before deployment if needed."
        : "";

    return `${setup}Alchemy provisions ${provider}, passes its connection credentials directly to the deployed application, and manages database deployment in the same stack as the consuming app. You do not need to copy a hosted \`DATABASE_URL\` into the app environment.

${migrationWorkflow}${costNote}
`;
  }

  if (isD1Alchemy) {
    const steps: string[] = [];

    if (dbSupport.hasDbGenerate) {
      steps.push(
        `${steps.length + 1}. ${
          orm === "prisma" ? "Generate the Prisma client" : "Generate migration files"
        }:
\`\`\`bash
${packageManagerRunCmd} db:generate
\`\`\``,
      );
    }

    if (dbSupport.hasDbMigrate) {
      steps.push(`${steps.length + 1}. Create and apply Prisma migrations locally:
\`\`\`bash
${packageManagerRunCmd} db:migrate
\`\`\``);
    }

    if (getLocalD1Owner(config) === "wrangler") {
      steps.push(`${steps.length + 1}. Apply the migrations to the local development database:
\`\`\`bash
${packageManagerRunCmd} db:migrate:local
\`\`\`
The framework dev server uses a local D1 database (via \`${backendRoot}/wrangler.jsonc\`); the deployed database is migrated by Alchemy during \`deploy\`.`);
    }

    return `${setup}This project uses Cloudflare D1 (SQLite)${ormDesc}.

Runtime database access uses the Cloudflare \`DB\` binding from \`packages/infra/alchemy.run.ts\`. If a local \`DATABASE_URL\` is present, it is only for database tooling.

Alchemy provisions the D1 database and applies migrations during \`deploy\`.

${steps.join("\n\n")}
`;
  }

  const dbDescriptions = {
    sqlite: `This project uses SQLite${ormDesc}.

1. Start the local SQLite database (optional):
${
  dbSetup === "d1"
    ? "D1 local development and migrations are handled automatically by Alchemy during dev and deploy."
    : `\`\`\`bash
${packageManagerRunCmd} db:local
\`\`\``
}

2. Update your \`${envPath}\` file with the appropriate connection details if needed.`,

    postgres: `This project uses PostgreSQL${ormDesc}.

1. Make sure you have a PostgreSQL database set up.
2. Update your \`${envPath}\` file with your PostgreSQL connection details.`,

    mysql: `This project uses MySQL${ormDesc}.

1. Make sure you have a MySQL database set up.
2. Update your \`${envPath}\` file with your MySQL connection details.`,

    mongodb: `This project uses MongoDB ${ormDesc.replace(" with ", "with ")}.

1. Make sure you have MongoDB set up.
2. Update your \`${envPath}\` file with your MongoDB connection URI.`,
  } satisfies Record<string, string>;

  setup += dbDescriptions[database] || "";

  if (dbSupport.hasDbPush) {
    setup += `

3. Apply the schema to your database:
\`\`\`bash
${packageManagerRunCmd} db:push
\`\`\`
`;
  }

  return setup;
}

function generateScriptsList(runCmd: string, config: RenderConfig, vfs: VirtualFileSystem): string {
  const sections: string[] = [];
  const rootScripts =
    vfs.readJson<{ scripts?: Record<string, string> }>("package.json")?.scripts ?? {};
  sections.push(...Object.keys(rootScripts).map((name) => `- \`${runCmd} ${name}\``));
  for (const app of guidanceApplications(config)) {
    const scripts = vfs.readJson<{ scripts?: Record<string, string> }>(
      `${app.directory}/package.json`,
    )?.scripts;
    if (!scripts) continue;
    sections.push(
      `\n### ${app.id}\n`,
      `Run from \`${app.directory}\`:`,
      ...Object.keys(scripts).map((name) => `- \`${runCmd} ${name}\``),
    );
    const note = getDesktopStaticBuildNote(app.frontend);
    if (note && config.addons.some((addon) => addon === "tauri" || addon === "electrobun"))
      sections.push(`\n${note}`);
  }
  return sections.join("\n");
}

function generateWorkspaceDeployment(config: RenderConfig, vfs: VirtualFileSystem): string {
  const applications = guidanceApplications(config);
  const scripts = vfs.readJson<{ scripts?: Record<string, string> }>("package.json")?.scripts ?? {};
  const run = `${config.packageManager} run`;
  const lines = [
    "## Deployment",
    "",
    "Application directories, roles and backend bindings are recorded in `applications.json`. Deploy each selected target with its generated root scripts below.",
  ];
  const commands = Object.keys(scripts).filter((name) =>
    /^(deploy(?::|$)|destroy(?::|$)|env:(?:.*:)?(?:preview|production)$|docker:|dev:.*:vercel$|dev:vercel$)/.test(
      name,
    ),
  );
  if (!commands.length) return "";
  const alchemy =
    applications.some(
      (app) => isAlchemyDeployTarget(app.webDeploy) || isAlchemyDeployTarget(app.serverDeploy),
    ) || config.addons.includes("axiom");
  if (alchemy) {
    const exec =
      config.packageManager === "npm"
        ? "npx"
        : config.packageManager === "pnpm"
          ? "pnpm exec"
          : "bunx";
    lines.push(
      "",
      "### Alchemy",
      "",
      `- Configure provider accounts: \`cd packages/infra && ${exec} alchemy profile edit\``,
      "- The shared infrastructure stack owns deployment and destruction for all Alchemy applications and the shared database.",
      "- Provider profiles are stored under `~/.alchemy`; no provider-specific setup command is required.",
      `- Deploys default to a personal \`dev_<username>\` stage. For production: \`cd packages/infra && ${exec} alchemy deploy --stage production\`.`,
    );
    const owner = applications.find((app) => app.roles.includes("backend"));
    if (owner && owner.backend !== "self" && isAlchemyDeployTarget(owner.serverDeploy)) {
      lines.push(
        `- After the first deploy, set \`CORS_ORIGIN\` in \`${owner.directory}/.env\` to the comma-separated deployed origins of every bound web client, then deploy again.`,
      );
    }
    if (
      owner &&
      config.auth === "better-auth" &&
      (owner.webDeploy === "prisma" || owner.serverDeploy === "prisma")
    ) {
      lines.push(
        `- After the first deploy, set \`BETTER_AUTH_URL\` in \`${owner.directory}/.env\` to the returned backend URL, then deploy again.`,
      );
    }
    if (config.addons.includes("axiom"))
      lines.push(
        "- Alchemy creates a stage-specific Axiom dataset and least-privilege ingest token. Development injects credentials in memory. Link Vercel targets before deploying the matching `preview` or `production` stage; personal stages do not change shared credentials. For deployed Docker images, supply `AXIOM_API_KEY`, `AXIOM_DATASET`, and `AXIOM_EDGE_URL` through the platform secret manager.",
      );
  }
  for (const app of applications) {
    const target = app.webDeploy !== "none" ? app.webDeploy : app.serverDeploy;
    if (target !== "vercel" && target !== "docker") continue;
    lines.push(
      "",
      `### ${app.id}: ${target === "vercel" ? "Vercel" : "Docker"}`,
      "",
      `- Application: \`${app.directory}\``,
    );
    if (target === "vercel")
      lines.push(
        `- Config: \`vercel.${app.id}.json\``,
        "- Link the target project before syncing preview/production environment variables. Deployment does not upload local `.env` files automatically; sync env before the first deployment.",
        "- The target's `deploy:*:check` command builds locally without deployment upload; it requires a linked project and its environment configuration.",
      );
    else
      lines.push(
        "- Config: `docker-compose.yml`. Each app owns its Dockerfile and `.env`; Compose overrides container-networking values. Public web variables are baked into the build.",
      );
  }
  if (
    applications.some((app) => app.webDeploy === "docker" || app.serverDeploy === "docker") &&
    config.database === "sqlite" &&
    config.dbSetup === "none"
  )
    lines.push(
      `\nDocker Compose uses \`./.data/local.db\`. Run \`${run} db:push\` before starting the stack.`,
    );
  lines.push(
    "",
    "### Generated deployment commands",
    "",
    ...commands.map((name) => `- \`${run} ${name}\``),
  );
  return `${lines.join("\n")}\n`;
}

function generateDeploymentCommands(
  packageManagerRunCmd: string,
  webDeploy: ProjectConfig["webDeploy"],
  serverDeploy: ProjectConfig["serverDeploy"],
  backend: ProjectConfig["backend"],
  auth: RenderConfig["auth"],
  frontend: ProjectConfig["frontend"],
  database: ProjectConfig["database"],
  dbSetup: ProjectConfig["dbSetup"],
  addons: ProjectConfig["addons"],
  backendRoot: string,
): string {
  const hasCloudflare = webDeploy === "cloudflare" || serverDeploy === "cloudflare";
  const hasPrismaCompute = webDeploy === "prisma" || serverDeploy === "prisma";
  const hasAxiom = addons.includes("axiom");
  const hasAlchemyCompute = hasCloudflare || hasPrismaCompute;
  const hasAlchemy = hasAlchemyCompute || hasAxiom;
  const hasDocker = webDeploy === "docker" || serverDeploy === "docker";
  const hasVercel = webDeploy === "vercel" || serverDeploy === "vercel";

  if (!hasAlchemy && !hasDocker && !hasVercel) {
    return "";
  }

  const lines: string[] = ["## Deployment"];

  if (hasAlchemy) {
    const targetLabel = [
      ...(isAlchemyDeployTarget(webDeploy)
        ? [`web on ${webDeploy === "cloudflare" ? "Cloudflare" : "Prisma"}`]
        : []),
      ...(isAlchemyDeployTarget(serverDeploy) && backend !== "self"
        ? [`server on ${serverDeploy === "cloudflare" ? "Cloudflare" : "Prisma"}`]
        : []),
      ...(hasAxiom ? ["Axiom observability"] : []),
    ].join(" + ");
    const alchemyDeployScript =
      !hasAlchemyCompute && (hasVercel || hasDocker)
        ? "deploy:infra"
        : hasVercel
          ? isAlchemyDeployTarget(webDeploy)
            ? "deploy:web"
            : "deploy:server"
          : "deploy";
    const alchemyExec = packageManagerRunCmd.startsWith("npm")
      ? "npx"
      : packageManagerRunCmd.startsWith("pnpm")
        ? "pnpm exec"
        : "bunx";

    lines.push(
      "",
      "### Alchemy",
      "",
      `- Target: ${targetLabel}`,
      `- Configure provider accounts: \`cd packages/infra && ${alchemyExec} alchemy profile edit\``,
      `- Dev: ${packageManagerRunCmd} dev`,
      `- Deploy: ${packageManagerRunCmd} ${alchemyDeployScript}`,
      `- Destroy: ${packageManagerRunCmd} destroy`,
      "",
      "`alchemy profile edit` stores the selected Axiom, Cloudflare, Neon, PlanetScale, and/or Prisma provider profiles under `~/.alchemy`; no provider-specific setup command is required by this scaffold.",
      "",
      "Deploys are staged and default to a personal `dev_<username>` stage. For production, run the deploy with an explicit stage from `packages/infra`:",
      "",
      "```bash",
      `cd packages/infra && ${alchemyExec} alchemy deploy --stage production`,
      "```",
    );

    if (hasAxiom) {
      lines.push(
        "",
        "Alchemy creates a stage-specific Axiom dataset and a least-privilege ingest token. `dev` injects the credentials into the observed apps without writing the token to an env file.",
      );
      if (hasVercel) {
        lines.push(
          "Link the Vercel project before the Alchemy deploy. Deploy from `packages/infra` with `alchemy deploy --stage preview` or `alchemy deploy --stage production` to sync Axiom credentials to the matching Vercel environment. Personal stages do not change shared Vercel credentials.",
        );
      }
      if (hasDocker) {
        lines.push(
          "For a deployed Docker image, pass `AXIOM_API_KEY`, `AXIOM_DATASET`, and `AXIOM_EDGE_URL` through the target platform's secret manager. Local observed development runs through Alchemy with the credentials injected in memory.",
        );
      }
    }

    const hasWeb = hasWebFrontend(frontend);
    const needsCorsOrigin = backend !== "self" && isAlchemyDeployTarget(serverDeploy) && hasWeb;
    const prismaAuthTarget =
      auth === "better-auth" && backend === "self" && webDeploy === "prisma"
        ? { envPath: `${backendRoot}/.env`, label: "backend application" }
        : auth === "better-auth" && backend !== "self" && serverDeploy === "prisma"
          ? { envPath: `${backendRoot}/.env`, label: "backend application" }
          : undefined;

    if (needsCorsOrigin || prismaAuthTarget) {
      lines.push("", "### Production origins", "");
    }
    if (needsCorsOrigin) {
      lines.push(
        `- Required after the first deploy: set \`CORS_ORIGIN\` in \`${backendRoot}/.env\` to the comma-separated deployed origins of all bound web clients listed in \`applications.json\`, then deploy the backend again.`,
      );
    }
    if (prismaAuthTarget) {
      lines.push(
        `- Prisma + Better Auth: after the first deploy, set \`BETTER_AUTH_URL\` in \`${prismaAuthTarget.envPath}\` to the returned ${prismaAuthTarget.label} URL, then deploy again.`,
      );
    }
  }

  if (hasDocker) {
    const targetLabel =
      webDeploy === "docker" && (serverDeploy === "docker" || backend === "self")
        ? "web + server"
        : webDeploy === "docker"
          ? "web"
          : "server";

    lines.push(
      "",
      "### Docker Compose",
      "",
      `- Target: ${targetLabel}`,
      "- Config: `docker-compose.yml` (Dockerfiles live in the deployed application directories listed in `applications.json`)",
      `- Build images: ${packageManagerRunCmd} docker:build`,
      `- Start: ${packageManagerRunCmd} docker:up`,
      `- Logs: ${packageManagerRunCmd} docker:logs`,
      `- Stop: ${packageManagerRunCmd} docker:down`,
      "",
      "Environment variables are read from each app's `.env` file (baked into web builds for public variables) and overridden in `docker-compose.yml` for container networking.",
    );

    if (
      database === "sqlite" &&
      dbSetup === "none" &&
      isDatabaseConsumedByDocker({ backend, serverDeploy, webDeploy })
    ) {
      lines.push(
        "",
        `Docker Compose uses the local \`./.data/local.db\` file. Run \`${packageManagerRunCmd} db:push\` before starting the stack.`,
      );
    }

    lines.push(
      "",
      "For more details, see the guide on [Deploying with Docker Compose](https://www.xstack.dev/docs/guides/docker).",
    );
  }

  if (hasVercel) {
    const vercelNames = getVercelScriptNames(webDeploy, serverDeploy);
    const targetLabel =
      webDeploy === "vercel" && (serverDeploy === "vercel" || backend === "self")
        ? "web + server"
        : webDeploy === "vercel"
          ? "web"
          : "server";

    lines.push(
      "",
      "### Vercel Services",
      "",
      `- Target: ${targetLabel}`,
      "- Config: `vercel.json`",
      `- Link the project first: ${packageManagerRunCmd} ${vercelNames.setup}`,
      `- Local Vercel dev: ${packageManagerRunCmd} dev:vercel`,
      `- Sync preview env: ${packageManagerRunCmd} ${vercelNames.envPreview}`,
      `- Sync production env: ${packageManagerRunCmd} ${vercelNames.envProduction}`,
      `- Dry-run check (no upload): ${packageManagerRunCmd} ${vercelNames.deployCheck}`,
      `- Preview deploy: ${packageManagerRunCmd} ${vercelNames.deploy}`,
      `- Production deploy: ${packageManagerRunCmd} ${vercelNames.deployProd}`,
    );

    if (webDeploy === "vercel" && serverDeploy === "vercel" && backend !== "self") {
      lines.push(
        "- Web requests under `/api/*` route to the server service, which serves those paths directly. Local server URLs include `/api` too.",
      );
    }

    lines.push(
      "Vercel Services share project environment variables, but deploys do not upload local `.env` files automatically. Link the project with `vercel link`, then run the env sync command before your first deploy (otherwise the deployment starts with no env vars), or pass one-off envs with `vercel deploy -e KEY=value`.",
      `Pass Vercel CLI flags to the env sync command directly, for example: \`${packageManagerRunCmd} ${vercelNames.envProduction} --scope your-team\`.`,
      "",
      "For more details, see the guide on [Deploying to Vercel](https://www.xstack.dev/docs/guides/vercel).",
    );
  }

  return `${lines.join("\n")}\n`;
}

function generateGitHooksSection(
  packageManagerRunCmd: string,
  addons: ProjectConfig["addons"],
): string {
  const hasHusky = addons.includes("husky");
  const hasLefthook = addons.includes("lefthook");
  const hasVitePlus = addons.includes("vite-plus");
  const hasVitePlusNativeHooks = hasVitePlus && !hasHusky && !hasLefthook;
  const hasLinting = addons.includes("biome") || addons.includes("oxlint") || hasVitePlus;

  if (!hasHusky && !hasLinting) {
    return "";
  }

  const lines: string[] = ["## Git Hooks and Formatting", ""];

  if (hasHusky) {
    lines.push(`- Initialize hooks: \`${packageManagerRunCmd} prepare\``);
  }

  if (hasVitePlusNativeHooks) {
    lines.push(
      `- Optional native Vite+ hooks: \`${packageManagerRunCmd} hooks:setup\``,
      "- Docs: [Vite+ commit hooks](https://viteplus.dev/guide/commit-hooks)",
    );
  }

  if (hasLinting) {
    lines.push(`- Run checks: \`${packageManagerRunCmd} check\``);
  }

  return `${lines.join("\n")}\n\n`;
}

function getVercelScriptNames(
  webDeploy: ProjectConfig["webDeploy"] | undefined,
  serverDeploy: ProjectConfig["serverDeploy"] | undefined,
) {
  const mixedCloud = isAlchemyDeployTarget(webDeploy) || isAlchemyDeployTarget(serverDeploy);
  const target = webDeploy === "vercel" ? "web" : "server";
  const deploy = mixedCloud ? `deploy:${target}` : "deploy";
  return {
    setup: "deploy:setup",
    envPreview: "env:preview",
    envProduction: "env:production",
    deploy,
    deployProd: `${deploy}:prod`,
    deployCheck: "deploy:check",
  };
}
