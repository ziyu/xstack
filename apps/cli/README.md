# Create xstack CLI

A modern CLI tool for scaffolding end-to-end type-safe TypeScript projects with best practices and customizable configurations

## Sponsors

<p align="center">
<img src="https://sponsors.xstack.dev/sponsors.png" alt="Sponsors">
</p>

![demo](https://cdn.jsdelivr.net/gh/ziyu/xstack@master/demo.gif)

## Quick Start

Run without installing globally:

```bash
# Using bun (recommended)
bun create xstack@latest

# Using pnpm
pnpm create xstack@latest

# Using npm
npx xstack@latest
```

Follow the prompts to configure your project or use the `--yes` flag for defaults.

The default is a Next.js full-stack shell with SQLite, Drizzle, Turborepo, and no optional feature modules. `--preset starter` adds authentication; `--preset saas-global` adds authentication, email, admin, payments and credits; `--preset full` selects every feature module, including AI, publishing, private storage, referral credits and Turnstile. These differ from legacy technology presets selected by `--template`.

```bash
xstack my-saas --preset saas-global \
  --providers auth:none email:smtp payment:polar \
  --module-options i18n.locales=zh-CN credits.signupBonus=50
```

OAuth providers are optional (`auth:none` explicitly selects none). Email supports Resend or SMTP; payments support Stripe, Polar, WeChat Native QR, Alipay desktop website payment, or development-only mock payments. Configure real provider credentials in the generated environment before using their services. The web Template Builder shares this catalog and includes provider/options state in commands, previews, saved preferences, and URLs.

The web Template Builder has a compact **Preset** dropdown, grouped by Next.js, TanStack Start and Nuxt. Each entry is a complete configuration: Shell and Starter use SQLite; Global SaaS and Full use PostgreSQL; all use Drizzle. Selecting an entry replaces the technology stack, modules, providers and options while preserving the project name. Customize with the controls below; the dropdown shows **Custom configuration** whenever the current settings no longer match a preset. Shared URLs and saved configurations restore the matching preset automatically.

### Application layouts

Use `--apps` with a JSON array of `{id,type,stack,product?,bindings?}` instances. Stable types (`fullstack-web`, `web-frontend`, `backend`, `admin`, `cli`, `native`) describe application responsibilities, not frameworks. `templates/apps/<type>/app.json` declares roles, dependencies and the required `defaultDirectoryName`. Each technology owns its implementation in its existing directory, for example `frontend/astro/apps/web-frontend`, `frontend/react/next/apps/fullstack-web`, or `backend/server/hono/apps/backend`. The adjacent `adapter.json` declares supported app types and stack defaults, not source/target paths. Supply `stack.framework` explicitly; changing `next` to `nuxt` does not change a `fullstack-web` application's type or roles.

```bash
# One complete product application plus an independent CLI
xstack my-product --yes --apps '[{"id":"product","type":"fullstack-web","stack":{"framework":"next"}},{"id":"tools","type":"cli","stack":{"framework":"node","runtime":"node"}}]'

# Separate web frontend, backend and admin applications plus a CLI
xstack my-workspace --yes --apps '[{"id":"frontend","type":"web-frontend","stack":{"framework":"react-router"}},{"id":"api","type":"backend","stack":{"framework":"hono","runtime":"node","api":"orpc"}},{"id":"admin","type":"admin","stack":{"framework":"react-router"}},{"id":"tools","type":"cli","stack":{"framework":"node","runtime":"node"}}]'
```

An instance's `id` determines `apps/<id>` and its workspace package name independently of type and framework. The manifest's `defaultDirectoryName` only suggests a name when adding or converting an application: `fullstack-web` defaults to `web`, `web-frontend` to `frontend`, and `backend`, `admin`, `cli` and `native` to their respective names. Names may be customized, duplicate suggestions receive numeric suffixes, and changing type preserves the chosen instance name. Product-scoped applications default to product `main`. `fullstack-web` owns `web-frontend`, `backend` and `admin`; each role has one owner per product, so it cannot coexist with split owners in that product. Independent `cli` applications own no product roles and may coexist with either layout or run alone. Required roles resolve to their unique owner; `bindings: {"backend":"api"}` names that owner explicitly. Unknown types/frameworks, unsupported adapter/type combinations, duplicate IDs, unsafe paths, conflicting owners, missing dependencies, invalid/cross-product bindings and cycles are rejected before project writes. The old `web`/`site` type IDs and `template` selection field are not supported. Legacy configurations without `apps` still generate physical `apps/web` output.

The optional `stack.runtime` and `stack.api` override supported adapter defaults. Next/Nuxt/Start `fullstack-web` adapters default to runtime/API `none`; standalone Hono defaults to Bun and oRPC. A Node CLI uses framework/runtime `node`, implemented in `cli/node/apps/cli`. Generation composes nearby ancestor `shared/` directories, the technology's own `shared/`, then its selected `apps/<type>/` directory. Optional `files/` contributes workspace-level files. A declared app needs its own implementation; shared files alone do not establish support. Module contributions retain `modules/<module>/frameworks/<framework>/apps/<type>`. Both sources write into the selected instance directory without rewriting literal template content.

Application instance IDs are opaque names, never build dispatch keys. Adapter `productContribution` declares server/client mode, a matching protocol, supported modules and stack constraints, framework contribution layers, and shared client sources. `sharedPackages` declares shared output ownership candidates; `devArgs` declares framework development-server arguments. Add a new app type by supplying its role manifest, technology implementation and required module overlays; add a new adapter by declaring its actual capabilities. The generator does not maintain a split-app type/framework allowlist. Missing selected contributions remain errors, and declarations do not substitute for implementing a new framework or protocol.

`applications.json` records resolved roles/bindings plus each instance's `directory`, `port`, `origin` and `devArgs`; runtime tooling consumes these fields rather than guessing names or ports. `xstack.jsonc` and reproducible commands retain user selections only. `bun run dev:<id>` starts an application. Port allocation follows roles rather than lexical instance names; independent apps do not acquire product ownership. Service packages and database environment imports belong to the backend. Explicit application generation currently supports one product plus independent applications, no automatic deployment/database provisioning, and only the Turborepo addon. Legacy no-app and framework-specific deployment processors remain separate migration work.

Contribution validation runs before generation: unknown application directories and missing selected provider/integration implementations fail explicitly. `resolveWorkspaceCapabilities` is shared by CLI and Builder and distinguishes native modules from stack adapters. The native split identity lane supports explicit React Router frontend/admin + Hono (Bun or Node), API `none`, Drizzle SQLite/Postgres, and core/i18n/auth/admin/email/sms/captcha. It generates a permission-protected admin console, same-origin client proxies and backend-owned services. Existing oRPC/tRPC and other framework combinations retain their stack-auth limitations; transaction/content modules are not enabled by this identity lane. Client origins are declared explicitly; adjust backend allowlists and provider callbacks when changing origins. Email/SMS/cloud captcha and real OAuth exchanges require separate provider credentials and live delivery verification.

Administrator bootstrap requires proof of email ownership: `ADMIN_EMAILS` no longer grants privilege to an unverified signup. Configure email verification or verified-email OAuth; otherwise an operator must promote the first admin through a trusted database channel after checking identity. The `admin` application type alone is a shell, not authorization: select the `admin` feature for protected user management. Email-enabled identity includes verification resend, and all native C2 clients preserve renewed SSR cookies. Run the reusable matrix with `bun apps/cli/live-tests/c2.ts plan`; see [live-test instructions](./live-tests/README.md).

For template maintainers, run `bun run --filter @xstack/template-generator audit:contributions` to inspect source ownership, app/framework coverage and explicitly legacy branches; add `--sources` when invoking `bun packages/template-generator/scripts/audit-contributions.ts` for individual source records. This structural inventory is not a replacement for generated-project runtime acceptance.

Use `generate({ config, templates, trace: true })` to inspect `result.value.provenance`: ordered physical-path create/update/delete operations with the originating template or processor, application/owner, and previous source. Tracing is off by default and never records file contents or secrets. Repository maintainers can run `bun packages/template-generator/scripts/trace-contributions.ts <project-config.json> [output-path]`; the input is a complete `ProjectConfig`, not the persisted `xstack.jsonc` subset. This command generates only an in-memory tree and prints provenance; it does not create a project.

The Builder's **Applications** editor only manages instances, names and types. Select an application tab, then configure its framework, runtime and connections in **Application technology** below. Framework choices come from actual template implementations for that app type; changing one application leaves the others unchanged. Backend API protocol is an advanced setting, displayed read-only by bound frontend/admin clients; the ordinary fullstack panel does not show a misleading “No API” selector. Shared database and tooling remain separate. Occupied product roles cannot be added again; independent CLI apps can coexist. Renaming a backend updates its explicit bindings. Compact complete presets, commands, previews, saved preferences and shared URLs retain the complete app list. Invalid layouts remain visible with errors rather than silently dropping apps or features. Old shared URLs retain legacy controls and offer explicit conversion.

Phone-number OTP login selects both `auth` and `sms`, with one SMS provider: `--features auth sms --providers auth:none sms:aliyun` (or `sms:tencent` / `sms:twilio`). Native Next.js, TanStack Start and Nuxt + Drizzle projects share the same authentication domain. Configure the provider in `apps/web/.env`; local development can explicitly use `SMS_DELIVERY_MODE=console`. Production requires real provider credentials.

WeChat website login uses `--features auth --providers auth:wechat` on native Next.js, TanStack Start or Nuxt/Drizzle. Configure `WECHAT_CLIENT_ID`, `WECHAT_CLIENT_SECRET` and the callback domain for `BETTER_AUTH_URL`. The endpoint is `/api/auth/callback/wechat`; mini-program and official-account credentials are not supported by this website flow.

Domestic payments: `--features auth payment credits --providers auth:none payment:wechat,alipay` generates CNY one-time credit packs and a signed-in QR checkout page. No automatic renewals, H5 payments or refunds are included. Configure merchant approval, keys and public HTTPS callbacks using the generated `docs/modules/payment.md`; browser return URLs never confirm payment.

Private files: `--features storage --providers auth:none storage:s3` supports S3, R2 API, OSS and COS on Node. Cloudflare uses `storage:r2-binding`, D1 and authenticated streamed downloads. API providers issue 60-second attachment URLs; browser uploads are capped at 4 MiB. Configure private buckets and least-privilege credentials using the generated storage documentation.

P3 modules: `ai` provides chat/image/video jobs with provider capabilities, optional idempotent credit charging/refunds and generated-media storage; `blog` provides admin publishing and public localized articles; `seo` adds public metadata/sitemap; `affiliate` awards app credits for verified referred purchases; `captcha` enforces Turnstile before authentication mutations. `full` enables all of them. Configure `SITE_URL`, email verification and Turnstile before using full-preset signup. Unknown AI provider outcomes are never automatically resubmitted or refunded; reconcile them with the provider.

For Cloudflare full: select `--preset full --database sqlite --db-setup d1 --web-deploy cloudflare --providers storage:r2-binding`. Generated docs describe local D1 migrations, OpenNext build/preview and production Alchemy provisioning. Node-only providers are rejected on Workers; selected features are never silently omitted.

Generated projects now include root `AGENTS.md` and `.agents/skills/xstack-project/SKILL.md`, derived from selected modules and actual commands. Append project-specific rules in their final notes sections. CLI creation also records secret-free generation ancestry in `.xstack/baseline/manifest.json`.

Add modules later with `xstack add --features credits payment --providers payment:stripe --dry-run`, then repeat without dry-run. Non-overlapping user changes are preserved; conflicts stop before project/config/baseline writes. Keep the baseline in version control. `.env` values are preserved and missing declarations appended. Existing projects without ancestry require explicit clean-scaffold adoption with `xstack add --features none --initialize-baseline`. Feature additions are separate from addon/package/deployment changes; install dependencies and review/apply schema migrations afterward.

Choose `--frontend tanstack-start` or `--frontend nuxt` together with `--backend self --api none --orm drizzle` to generate the same selected modules on another framework. Next and Start share framework-neutral React forms/components; Nuxt uses native Vue components. Start and Nuxt share a WHATWG HTTP adapter over the same services, preserving auth, authorization, webhook and ownership checks. Read generated commands for the selected framework: Start uses Vite dev/build/preview; Nuxt uses Nuxt dev/build and its Nitro production output.

## Requirements

- Node.js 22.12 or newer to run the CLI with Node.js. The selected framework may require a newer release; the CLI checks the exact stack before writing files.
- Bun 1.4 or newer is recommended. Bun 1.2.14 remains the minimum because generated workspaces use dependency catalogs.
- pnpm 10.26.0 or newer when using pnpm (catalogs and `allowBuilds`).
- npm 11.16.0 or newer when using npm (`allowScripts`).

Docker Compose 2.24 or newer is required by generated Docker stacks. Git, Rust, Docker,
and platform SDKs otherwise remain optional and are only needed when you use their corresponding
generated commands.

## Features

| Category                 | Options                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TypeScript**           | End-to-end type safety across all parts of your application                                                                                                                                                                                                                                                                                                                                                                               |
| **Frontend**             | • React with TanStack Router<br>• React with React Router<br>• React with TanStack Start (SSR)<br>• Next.js<br>• SvelteKit<br>• Nuxt (Vue)<br>• Solid (SSR)<br>• Astro<br>• React Native bare Expo<br>• React Native with NativeWind (via Expo)<br>• React Native with Unistyles (via Expo)<br>• None                                                                                                                                     |
| **Backend**              | • Hono<br>• Express<br>• Elysia<br>• Fastify<br>• Self (fullstack inside the web app)<br>• Convex<br>• None                                                                                                                                                                                                                                                                                                                               |
| **API Layer**            | • tRPC (type-safe APIs)<br>• oRPC (OpenAPI-compatible type-safe APIs)<br>• None                                                                                                                                                                                                                                                                                                                                                           |
| **Runtime**              | • Bun<br>• Node.js<br>• Cloudflare Workers<br>• None                                                                                                                                                                                                                                                                                                                                                                                      |
| **Database**             | • SQLite<br>• PostgreSQL<br>• MySQL<br>• MongoDB<br>• None                                                                                                                                                                                                                                                                                                                                                                                |
| **ORM**                  | • Drizzle (TypeScript-first)<br>• Prisma (feature-rich)<br>• Mongoose (for MongoDB)<br>• None                                                                                                                                                                                                                                                                                                                                             |
| **Database Setup**       | • Turso (SQLite)<br>• Cloudflare D1 (SQLite)<br>• Neon (PostgreSQL)<br>• Supabase (PostgreSQL)<br>• Prisma Postgres<br>• MongoDB Atlas<br>• None (manual setup)                                                                                                                                                                                                                                                                           |
| **Authentication**       | • Better Auth<br>• Clerk                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Styling**              | Tailwind CSS with a shared shadcn/ui package for React web apps                                                                                                                                                                                                                                                                                                                                                                           |
| **Addons**               | • PWA support<br>• Tauri (desktop applications)<br>• Electrobun (lightweight desktop shell)<br>• Starlight and Fumadocs (documentation sites)<br>• Biome, Oxlint, Ultracite, or Vite+ (linting and formatting)<br>• Lefthook, Husky (Git hooks)<br>• evlog (request logging for server/fullstack backends)<br>• MCP, Skills (agent tooling)<br>• OpenTUI, WXT (platform extensions)<br>• Turborepo, Nx, or Vite+ (monorepo orchestration) |
| **Product modules**      | All feature modules support Next.js, TanStack Start and Nuxt full-stack with Drizzle and SQLite/PostgreSQL; Cloudflare native modules use Next/OpenNext only                                                                                                                                                                                                                                                                              |
| **Developer Experience** | • Automatic Git initialization<br>• Package manager choice (npm, pnpm, bun)<br>• Automatic dependency installation                                                                                                                                                                                                                                                                                                                        |

## Usage

```bash
Usage: xstack [project-directory] [options]

Options:
  -V, --version                   Output the version number
  -y, --yes                       Use default configuration
  --template <type>               Use a template (mern, pern, t3, uniwind, none)
  --database <type>               Database type (none, sqlite, postgres, mysql, mongodb)
  --orm <type>                    ORM type (none, drizzle, prisma, mongoose)
  --dry-run                       Validate configuration without writing files
  --features <modules...>         auth, email, sms, admin, payment, credits, storage, ai, seo, blog, affiliate, captcha, none
  --preset <name>                 Feature preset (starter, saas-global, full)
  --providers <pairs...>          Module providers (feature:provider, e.g. payment:polar)
  --module-options <pairs...>     Module options (module.key=value, e.g. auth.engine=clerk)
  --frontend <types...>           Frontend types (tanstack-router, react-router, tanstack-start, next, nuxt, svelte, solid, astro, native-bare, native-uniwind, native-unistyles, none)
  --addons <types...>             Additional addons (pwa, tauri, electrobun, starlight, biome, lefthook, husky, mcp, turborepo, nx, vite-plus, fumadocs, ultracite, oxlint, opentui, wxt, skills, evlog, none)
  --git                           Initialize git repository
  --no-git                        Skip git initialization
  --package-manager <pm>          Package manager (npm, pnpm, bun)
  --install                       Install dependencies
  --no-install                    Skip installing dependencies
  --open <target>                 Open in an editor, IDE, or coding agent after creation
  --db-setup <setup>              Database setup (turso, d1, neon, supabase, prisma-postgres, planetscale, mongodb-atlas, docker, none)
  --web-deploy <setup>            Web deployment (cloudflare, docker, vercel, none)
  --server-deploy <setup>         Server deployment (cloudflare, docker, vercel, none)
  --backend <framework>           Backend framework (hono, express, fastify, elysia, convex, self, none)
  --runtime <runtime>             Runtime (bun, node, workers, none)
  --api <type>                    API type (trpc, orpc, none)
  --directory-conflict <strategy> Directory strategy (merge, overwrite, increment, error)
  --manual-db                     Skip automatic database setup prompts
  -h, --help                      Display help
```

### Agent-Focused Commands

```bash
# Raw JSON payload input (agent-friendly)
xstack create-json --json '{"projectName":"my-app","yes":true,"dryRun":true}'
xstack add-json --json '{"projectDir":"./my-app","addons":["wxt"],"addonOptions":{"wxt":{"template":"react"}}}'
xstack create-json --json '{"projectName":"db-app","database":"postgres","orm":"drizzle","dbSetup":"neon","dbSetupOptions":{"mode":"manual"}}'

# Runtime schema/introspection output
xstack schema --name all
xstack schema --name createInput
xstack schema --name addInput
xstack schema --name addonOptions
xstack schema --name dbSetupOptions
xstack schema --name cli

# Local stdio MCP server
npx xstack@latest mcp
```

To install xstack into supported agent configs with `add-mcp` and avoid relying on a global CLI install:

```bash
npx -y add-mcp@latest "npx -y xstack@latest mcp"
```

When you scaffold with the `mcp` addon, xstack itself can also be installed into supported agent configs through `add-mcp` using a package runner command instead of assuming a global CLI install. For Bun projects, the generated config uses the equivalent `bunx xstack@latest mcp` server command inside `add-mcp`.

For MCP project creation, prefer `install: false`. Long dependency installs can exceed common MCP client request timeouts, so the safest flow is to scaffold first and run your package manager install command afterward in the project directory.

## Telemetry

This CLI collects anonymous usage data to help improve the tool. The data collected includes:

- Configuration options selected
- CLI version
- Node.js version
- Platform (OS)
- How the CLI was driven (prompts, flags, `--yes`, JSON, the programmatic API, or the MCP server)

Separately, one anonymous failure event is sent when a scaffold breaks (stage and error class, never full messages or paths). See the [analytics documentation](https://xstack.dev/docs/analytics) for details.

**Telemetry is enabled by default in published versions** to help us understand usage patterns and improve the tool.

### Disabling Telemetry

You can disable telemetry by setting the `XSTACK_TELEMETRY_DISABLED` environment variable:

```bash
# Disable telemetry for a single run
XSTACK_TELEMETRY_DISABLED=1 npx xstack

# Disable telemetry globally in your shell profile (.bashrc, .zshrc, etc.)
export XSTACK_TELEMETRY_DISABLED=1
```

The CLI also honors the cross-tool `DO_NOT_TRACK=1` convention (https://consoledonottrack.com), and `--disable-analytics` skips telemetry for a single run.

## Examples

Create a project with default configuration:

```bash
npx xstack --yes
```

Validate a command without writing files:

```bash
npx xstack --yes --dry-run
```

Create a project with specific options:

```bash
npx xstack --database postgres --orm drizzle --features auth --addons pwa biome
```

Create a project with Elysia backend and Node.js runtime:

```bash
npx xstack --backend elysia --runtime node
```

Create a project with multiple frontend options (one web + one native):

```bash
npx xstack --frontend tanstack-router native-bare
```

Create a project with Turso database setup:

```bash
npx xstack --database sqlite --orm drizzle --db-setup turso
```

Create a project with Supabase PostgreSQL setup:

```bash
npx xstack --database postgres --orm drizzle --db-setup supabase --features auth
```

Create a project with Convex backend:

```bash
npx xstack --backend convex --frontend tanstack-router
```

Create a project with documentation site:

```bash
npx xstack --addons starlight
```

Create a minimal TypeScript project with no backend:

```bash
npx xstack --backend none --frontend tanstack-router
```

Create a backend-only project with no frontend:

```bash
npx xstack --frontend none --backend hono --database postgres --orm drizzle
```

Create a simple frontend-only project:

```bash
npx xstack --backend none --frontend next --addons none --features none
```

Create a Cloudflare Workers project:

```bash
npx xstack --backend hono --runtime workers --database sqlite --orm drizzle --db-setup d1
```

Create a self-hosted fullstack project on Cloudflare with D1:

```bash
npx xstack --backend self --frontend next --api trpc --database sqlite --orm drizzle --db-setup d1 --web-deploy cloudflare
```

Create a self-hosted project that ships as Docker containers (web + server + database via Docker Compose):

```bash
npx xstack --frontend tanstack-router --backend hono --runtime bun --database postgres --orm drizzle --db-setup docker --web-deploy docker --server-deploy docker
```

Create a minimal API-only project:

```bash
npx xstack --frontend none --backend hono --api trpc --database none --addons none
```

## Compatibility Notes

- **Convex backend**: Requires `database`, `orm`, `api`, `runtime`, and `server-deploy` to be `none`; auth can be `better-auth`, `clerk`, or `none` depending frontend compatibility
- **Backend 'none'**: If selected, this option will force related options like API, ORM, database, authentication, and runtime to 'none'. Examples will also be disabled (set to none/empty).
- **Frontend 'none'**: Creates a backend-only project. When selected, PWA, Tauri, Electrobun, and certain examples may be disabled.
- **API 'none'**: Disables tRPC/oRPC setup. Can be used with backend frameworks for REST APIs or custom API implementations.
- **Database 'none'**: Disables database setup and requires ORM to be `none`.
- **ORM 'none'**: Can be used when you want to handle database operations manually or use a different ORM.
- **Runtime 'none'**: Only available with Convex backend, backend `none`, or backend `self`.
- **Cloudflare Workers runtime**: Only compatible with Hono backend. If a database is used, MongoDB is not supported.
- **Cloudflare D1 setup**: Requires `sqlite` and either `--runtime workers --server-deploy cloudflare` or `--backend self --web-deploy cloudflare`. For `backend self`, D1 is supported on `next`, `tanstack-start`, `nuxt`, `svelte`, `solid`, and `astro`.
- **Addons 'none'**: Skips all addons.
- **Examples 'none'**: Skips all example implementations (todo, AI chat).
- **Nuxt, Svelte, Solid, and Astro** frontends are only compatible with the oRPC API layer
- **PWA support** requires TanStack Router, React Router, Next.js, or Solid
- **Tauri desktop app** requires TanStack Router, React Router, TanStack Start, Next.js, Nuxt, SvelteKit, or Astro
- **Electrobun desktop app** requires TanStack Router, React Router, TanStack Start, Next.js, Nuxt, SvelteKit, or Astro. Desktop packaging uses static web assets, so SSR-first frontends need a static/export build before desktop builds will work.
- **AI example** is not compatible with Solid or Astro. With Convex backend, it also excludes Nuxt and Svelte.

## Project Structure

The created project follows a clean monorepo structure:

```
my-better-t-app/
├── apps/
│   ├── web/          # Frontend application
│   ├── server/       # Backend API
│   ├── native/       # (optional) Mobile application
│   └── docs/         # (optional) Documentation site
├── packages/         # Shared packages
└── README.md         # Auto-generated project documentation
```

After project creation, you'll receive detailed instructions for next steps and additional setup requirements.
