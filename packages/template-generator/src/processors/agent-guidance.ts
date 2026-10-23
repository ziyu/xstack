import type { ProjectConfig } from "@xstack/types";

import type { VirtualFileSystem } from "../core/virtual-fs";
import { getModulePlan } from "../modules/pipeline";
import type { ResolvedModule } from "../modules/types";

type Workspace = {
  directory: string;
  name?: string;
  scripts: Record<string, string>;
};

function workspaces(vfs: VirtualFileSystem): Workspace[] {
  return vfs
    .getAllFiles()
    .filter((path) => /^(apps|packages)\/[^/]+\/package\.json$/.test(path))
    .map((path) => {
      const pkg = vfs.readJson<{ name?: string; scripts?: Record<string, string> }>(path);
      return {
        directory: path.slice(0, -"/package.json".length),
        name: pkg?.name,
        scripts: pkg?.scripts ?? {},
      };
    });
}

function moduleLines(vfs: VirtualFileSystem, modules: ResolvedModule[], prefix = ""): string[] {
  if (!modules.length)
    return [
      "No feature modules are selected. Do not assume product-shell routes, services, or feature packages exist.",
    ];
  return modules.map((module) => {
    const { manifest, providers, options, reason, variant } = module;
    const doc = `docs/modules/${manifest.id}.md`;
    const title = vfs.fileExists(doc) ? `[${manifest.id}](${prefix}${doc})` : `\`${manifest.id}\``;
    const selectedBy = reason.kind === "required-by" ? `required by ${reason.by}` : reason.kind;
    const settings = Object.entries(options).map(
      ([key, value]) => `${key}=${JSON.stringify(value)}`,
    );
    return `- ${title}: ${manifest.name.en}; ${selectedBy}; ${variant} implementation${providers.length ? `; providers: ${providers.map((provider) => `\`${provider}\``).join(", ")}` : ""}${settings.length ? `; options: ${settings.map((value) => `\`${value}\``).join(", ")}` : ""}.`;
  });
}

function addCommand(config: ProjectConfig): string {
  if (config.packageManager === "bun") return "bunx xstack@latest add";
  if (config.packageManager === "pnpm") return "pnpm dlx xstack@latest add";
  return "npx xstack@latest add";
}

/** Render after all module, script, env, and config post-processing, before taking a baseline. */
export function processAgentGuidance(vfs: VirtualFileSystem, config: ProjectConfig): void {
  const modules = getModulePlan(config).modules;
  const packages = workspaces(vfs);
  const scripts = vfs.readJson<{ scripts?: Record<string, string> }>("package.json")?.scripts ?? {};
  const run = `${config.packageManager} run`;
  const hasConfig = vfs.fileExists("xstack.jsonc");
  const cloudflare = config.webDeploy === "cloudflare" || config.serverDeploy === "cloudflare";
  const d1 = config.dbSetup === "d1";
  const schemas = vfs.getAllFiles().filter((path) => path.endsWith("/.env.schema"));
  const docs = vfs.getAllFiles().filter((path) => /^docs\/.*\.md$/.test(path));
  const frontendInstructions = vfs.getAllFiles().filter((path) => path.endsWith("/AGENTS.md"));
  const commandLines = Object.keys(scripts)
    .filter((name) => !["preinstall", "install", "postinstall", "prepare"].includes(name))
    .sort()
    .map((name) => `- \`${run} ${name}\``);
  const workspaceCommands = packages.flatMap(({ directory, scripts: commands }) =>
    Object.keys(commands)
      .filter((name) =>
        /^(build:cloudflare|preview:cloudflare|dev:bare|db:migrate:local)$/.test(name),
      )
      .sort()
      .map((name) => `- From \`${directory}\`: \`${run} ${name}\``),
  );
  const boundaries = [
    "Keep application routes and UI in their owning app; use workspace packages through their declared exports, not another package's private files. Validate external inputs and enforce authorization on the server.",
    ...packages
      .filter(({ directory }) => vfs.fileExists(`${directory}/src/services.ts`))
      .map(
        ({ directory }) =>
          `\`${directory}/src/services.ts\` is the composition root: initialize services there and inject configuration/clients into shared packages rather than importing app-owned environment accessors into packages.`,
      ),
    ...(vfs.directoryExists("packages/events")
      ? [
          `Declare typed domain events by augmenting \`EventMap\` in \`@${config.projectName}/events\`. The in-process bus awaits handlers in order; errors reject \`emit\`. It is not a durable queue and does not provide retries.`,
          ...(vfs.directoryExists("apps/web/src/integrations")
            ? [
                "Cross-feature subscriptions live in `apps/web/src/integrations/`. Keep feature services independent; wire only the integrations for enabled modules and preserve idempotency at side-effect boundaries.",
              ]
            : [
                "Keep cross-feature event wiring in the application composition root, not in another module's internals.",
              ]),
        ]
      : []),
    ...(vfs.fileExists("apps/web/src/config/navigation.ts")
      ? [
          "Update `apps/web/src/config/navigation.ts` alongside new pages; do not expose protected navigation without matching server-side authorization.",
        ]
      : []),
    ...(vfs.directoryExists("apps/web/src/app/[lang]")
      ? [
          "Product pages live under `apps/web/src/app/[lang]/`; preserve locale routing and add translations in the selected i18n workspace rather than hard-coding user-facing copy.",
        ]
      : []),
  ];
  const database = [
    `Database: \`${config.database}\`; ORM: \`${config.orm}\`; provisioning: \`${config.dbSetup}\`.`,
    ...(config.database === "none"
      ? ["No database is configured. Do not invent database setup or migration commands."]
      : [
          ...(scripts["db:generate"]
            ? [
                `After schema changes run \`${run} db:generate\` and review the generated client or migration output before applying database changes.`,
              ]
            : []),
          ...(d1
            ? [
                "D1 is a Cloudflare binding, not a libSQL URL. Never use `db:push` against D1, invent a DATABASE_URL for the binding, or assume interactive transactions are available.",
                ...(scripts["db:migrate:local"]
                  ? [
                      `Apply local D1 migrations with \`${run} db:migrate:local\`. Production D1 provisioning and migrations are owned by the generated Alchemy deployment, not direct deployment of a local Wrangler configuration.`,
                    ]
                  : [
                      "Use the generated Alchemy dev/deploy workflow for D1 migrations; do not invent a local migration script.",
                    ]),
              ]
            : [
                ...(scripts["db:migrate"]
                  ? [
                      `Apply reviewed migrations with \`${run} db:migrate\` against an explicitly chosen development database. Back up production and obtain approval before production schema changes.`,
                    ]
                  : []),
                ...(scripts["db:push"]
                  ? [
                      `\`${run} db:push\` is for intentional development schema synchronization, not a substitute for reviewed production migrations.`,
                    ]
                  : []),
              ]),
        ]),
  ];
  const deployment = [
    `Web target: \`${config.webDeploy}\`; server target: \`${config.serverDeploy}\`; runtime: \`${config.runtime}\`.`,
    "Deployment, infrastructure destruction, production migrations, and paid provider calls require explicit approval. Inspect the generated scripts and deployment documentation before running them.",
    ...(cloudflare
      ? [
          "Worker runtime code reads native request-scoped bindings. Keep Node-only SDKs and deployment-time Varlock loading out of Worker bundles; Alchemy validates deployment inputs outside the Worker.",
          ...(config.frontend.includes("next") && config.webDeploy === "cloudflare"
            ? [
                "Next.js runs through OpenNext with Node compatibility, not Next Edge. Local Wrangler resource IDs are not production deployment configuration.",
              ]
            : []),
          ...(modules.some((module) => module.providers.includes("r2-binding"))
            ? [
                "Storage uses the private `STORAGE_BUCKET` R2 binding. Preserve owner checks and authenticated streaming routes; do not replace the binding with a public bucket URL or leak object access.",
              ]
            : []),
        ]
      : []),
    ...(config.webDeploy === "none" && config.serverDeploy === "none"
      ? ["No app deployment target is selected. Do not assume a deploy script exists."]
      : []),
  ];
  const secrets = [
    "Never commit real credentials, tokens, private keys, `.env` values, or `.dev.vars` values. Never echo them into logs, docs, screenshots, conflict reports, or agent messages. Use ignored local env files and the deployment secret manager.",
    "Only intentionally public values may reach browser bundles. Commit environment schemas with safe placeholders/defaults, never secret defaults. Preserve existing local secrets when adding modules; fill newly required variables locally.",
    ...schemas.map((path) => `Environment contract: [\`${path}\`](${path}).`),
    ...(schemas.length
      ? [
          "Follow each app's generated environment accessor and schema. Shared packages receive configuration from the owning app; do not add ad-hoc process.env reads.",
        ]
      : []),
    ...(cloudflare && vfs.fileExists("apps/web/.dev.vars")
      ? [
          "For local workerd previews keep `apps/web/.dev.vars` synchronized with the required local values in `apps/web/.env`; both are secret-bearing and must remain uncommitted.",
        ]
      : []),
    "`.xstack/baseline/` is generator-owned merge ancestry, not a backup of local edits. Commit its generated manifest when present; never put secrets into it or modify it by hand. Transaction and lock files are local-only.",
  ];
  const verification = Object.keys(scripts).filter((name) =>
    /^(env:generate|check-types|check|lint|test(?::.*)?|build)$/.test(name),
  );
  const evolution = [
    hasConfig
      ? "Read [xstack.jsonc](xstack.jsonc) before changing the stack. It records selected features, provider overrides and module options; dependency/foundation modules below are the resolved result, not additional manual selections."
      : "This preview has no persisted xstack.jsonc. Persist a versioned generator configuration when creating the project before using the add workflow; do not fabricate a baseline from edited files.",
    `From the project root, preview additions with \`${addCommand(config)} --features <feature-id> --dry-run\`; omit \`--dry-run\` only after reviewing the plan. Provider overrides use \`--providers module:provider\`; options use \`--module-options module.key=value\`. Replace the metavariables with real catalog IDs and values.`,
    `The add workflow merges generated changes against the saved baseline while preserving local edits. Review conflicts instead of replacing project files or editing baseline metadata. If the project has no trustworthy baseline, \`${addCommand(config)} --features none --initialize-baseline\` adopts only files that match a clean reproduction with the current generator version. Resolve mismatches using the original clean scaffold; never reconstruct ancestry from modified files or overwrite user work to force adoption.`,
    "Keep unrelated user changes intact. Update affected routes, service wiring, schemas, docs and tests together. Do not add instructions for features or providers that are not selected.",
    ...(verification.length
      ? [
          `After an implementation change, run applicable checks from the existing root scripts: ${verification.map((name) => `\`${run} ${name}\``).join(", ")}. Configure required local environment first; do not use production credentials just to make a check pass.`,
        ]
      : [
          "No root verification scripts are present; inspect the owning workspace manifest rather than inventing a test or build command.",
        ]),
    "Inspect the owning workspace for additional checks; never claim an unrun check passed. Report the exact commands exercised, failures and any required external credentials.",
  ];
  const root = [
    `# Agent guidance for ${config.projectName}`,
    "",
    "These instructions describe this generated project. Read more specific AGENTS.md files before editing their subtree. This file and the project skill are normal editable files; future module additions use the same three-way merge as source code.",
    "",
    "## Workspace",
    "",
    `Package manager: \`${config.packageManager}\`. Install from the repository root with \`${config.packageManager} install\`. Frontends: ${config.frontend.map((value) => `\`${value}\``).join(", ") || "none"}; backend: \`${config.backend}\`; API: \`${config.api}\`.`,
    "",
    ...packages.map(
      ({ directory, name }) =>
        `- [\`${directory}\`](${directory}/package.json)${name ? ` — \`${name}\`` : ""}`,
    ),
    ...frontendInstructions.map(
      (path) => `- Follow [\`${path}\`](${path}); preserve framework-maintained instructions.`,
    ),
    "",
    "## Resolved feature modules",
    "",
    ...moduleLines(vfs, modules),
    "",
    "## Available commands",
    "",
    "These scripts exist in the generated root package.json. Read their definitions before execution; availability does not imply permission to deploy, destroy infrastructure, change data, or call paid services.",
    "",
    ...commandLines,
    ...workspaceCommands,
    "",
    "## Feature boundaries and events",
    "",
    ...boundaries.map((line) => `- ${line}`),
    "",
    "## Database workflow",
    "",
    ...database.map((line) => `- ${line}`),
    "",
    "## Deployment",
    "",
    ...deployment.map((line) => `- ${line}`),
    "",
    "## Secrets and environment",
    "",
    ...secrets.map((line) => `- ${line}`),
    "",
    "## Editing, adding modules and verification",
    "",
    ...evolution.map((line) => `- ${line}`),
    "",
    "## Project references",
    "",
    "- [Project skill](.agents/skills/xstack-project/SKILL.md)",
    ...(vfs.fileExists("README.md") ? ["- [README](README.md)"] : []),
    ...docs.map((path) => `- [${path}](${path})`),
    "",
    "## Project-specific notes",
    "",
    "Add project-owned conventions below. Keep this section after the generated references so module additions can update references independently of your notes.",
    "",
  ];
  vfs.writeFile("AGENTS.md", root.join("\n"));
  vfs.writeFile(
    ".agents/skills/xstack-project/SKILL.md",
    [
      "---",
      "name: xstack-project",
      "description: Work on this generated XStack project, its selected feature modules, providers, environment, migrations, and safe module additions. Use when editing application code or changing the generated stack.",
      "---",
      "",
      "# Working with this XStack project",
      "",
      "All command working directories below are relative to the project root, not this skill directory.",
      "",
      "1. Read [root AGENTS.md](../../../AGENTS.md) and any subtree instructions before editing. Use its actual workspace and command inventory; preserve framework-maintained instructions.",
      ...(hasConfig
        ? [
            "2. Read [xstack.jsonc](../../../xstack.jsonc) for requested selections. The resolved modules below include automatic dependencies; inspect their generated docs before changing behavior.",
          ]
        : [
            "2. This unversioned preview has no xstack.jsonc. Create the versioned project before using add; never infer a merge baseline from local modifications.",
          ]),
      "3. Trace the owning workspace and application composition root. Keep services behind package exports, preserve existing authorization and input validation, and wire only selected integrations.",
      "4. Change source, schema, environment contracts, routes, translations and relevant documentation together. Never copy local secrets into instructions or baseline metadata.",
      `5. To add a feature, run \`${addCommand(config)} --features <feature-id> --dry-run\` from the root. Use \`--providers module:provider\` and \`--module-options module.key=value\` only for explicit overrides. Review the preview, then repeat without dry-run. Resolve conflicts without discarding local edits; stop for baseline adoption if the CLI reports missing ancestry.`,
      `   For a project without a baseline, \`${addCommand(config)} --features none --initialize-baseline\` only adopts a clean current-version reproduction. Preserve local edits and recover original clean files before attempting adoption; never manufacture baseline metadata.`,
      "6. Follow the database and deployment workflow in AGENTS.md. Run applicable existing checks, then summarize the changes and the exact verification results. Never deploy, destroy resources, use paid providers or modify production data without approval.",
      "",
      "## Resolved modules and provider choices",
      "",
      ...moduleLines(vfs, modules, "../../../"),
      "",
      "## Generated references",
      "",
      ...(vfs.fileExists("README.md") ? ["- [README](../../../README.md)"] : []),
      ...docs.map((path) => `- [${path}](../../../${path})`),
      "",
      "## Project-specific skill notes",
      "",
      "Add project-owned workflows below. Keep this section after the generated references so module additions can update references independently of your notes.",
      "",
    ].join("\n"),
  );
  const ignored = [".xstack/transaction", ".xstack/lock", ".dev.vars", ".dev.vars.*"];
  const gitignore = vfs.readFile(".gitignore") ?? "";
  const existing = new Set(gitignore.split(/\r?\n/).map((line) => line.trim()));
  const additions = ignored.filter((entry) => !existing.has(entry));
  if (additions.length) {
    vfs.writeFile(
      ".gitignore",
      `${gitignore.trimEnd()}\n\n# Local generator state and Worker secrets\n${additions.join("\n")}\n`,
    );
  }
}
