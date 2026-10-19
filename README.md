# xstack

xstack composes TypeScript product templates from infrastructure choices, feature modules, and providers. The CLI and visual Template Builder share the same generator and compatibility rules.

## Philosophy

- Roll your own stack: you pick only the parts you need, nothing extra.
- Composable products: add authentication, email, admin, payments, and credits only when needed.
- Latest dependencies: always use current, stable versions by default.
- Free and open source: forever.

## Quick Start

The commands below target the renamed packages. This repository migration does not publish npm packages or deploy the `xstack.dev` domains; use the local development commands until those services are available.

```bash
# Using bun (recommended)
bun create xstack@latest

# Using pnpm
pnpm create xstack@latest

# Using npm
npx xstack@latest
```

## Claude Code plugin

Want your AI assistant to scaffold and extend projects with xstack? Install the plugin and it will plan a valid stack and generate it through the bundled MCP server instead of hand-rolling boilerplate.

```bash
/plugin marketplace add ziyu/xstack
/plugin install xstack@xstack
```

Then ask: _"create a fullstack app with Next, Hono, Postgres and Better Auth"_, or run `/xstack:new <description>`. See [`plugin/`](plugin) and the [Agent Workflows docs](https://xstack.dev/docs/cli/agent-workflows#claude-code-plugin).

## Features

- Frontend: React (TanStack Router, React Router, TanStack Start), Next.js, Nuxt, Svelte, Solid, Astro, React Native (Bare, NativeWind, Unistyles), or none
- Backend: Hono, Express, Fastify, Elysia, Self (fullstack web app), Convex, or none
- API: tRPC or oRPC (or none)
- Runtime: Bun, Node.js, or Cloudflare Workers
- Databases: SQLite, PostgreSQL, MySQL, MongoDB (or none)
- ORMs: Drizzle, Prisma, Mongoose (or none)
- Product modules: authentication, transactional email, admin console, payments, and credits; native product templates use Next.js full-stack, Drizzle, SQLite or PostgreSQL, and no separate API layer
- Addons: Turborepo, Nx, PWA, Tauri, Electrobun, Biome, Lefthook, Husky, Starlight, Fumadocs, Ultracite, Oxlint, MCP, OpenTUI, WXT, Skills
- DB Setup: Turso, Neon, Supabase, Prisma PostgreSQL, MongoDB Atlas, Cloudflare D1, Docker
- Deployment choices: local Node hosting, Docker, Vercel, Cloudflare, or Prisma, subject to stack compatibility

Type safety end-to-end, clean monorepo layout, and zero lock-in: you choose only what you need.

## Repository Structure

This repository is organized as a monorepo containing:

- **CLI**: [`apps/cli`](apps/cli) - The scaffolding CLI tool
- **Documentation**: [`apps/web`](apps/web) - Official website and documentation
- **Plugin**: [`plugin`](plugin) - Claude Code plugin (MCP server + skills + commands + agent)

The homepage keeps only the introductory screen: the CLI banner, package-manager commands, stack-builder links, and live statistics. Sponsor, video, and tweet panels and horizontal pane navigation are removed; standalone documentation, builder, analytics, showcase, and sponsors routes remain available.

## Documentation

Visit [xstack.dev](https://xstack.dev) for documentation, guides, and examples. The Template Builder at `/new` starts from Shell, Starter, or Global SaaS, then configures feature modules, providers, locales, signup credits, infrastructure, and deployment. Its controls and compatibility checks use the generator's module catalog. Generated commands, file previews, saved preferences, and share links preserve the same product selections.

The builder never collects provider secrets. Configure SMTP/Resend, OAuth, and payment credentials in the generated project's environment before using those integrations. `auth:none` explicitly disables OAuth providers without removing email/password authentication. Builder regression checks: `bun run build:cli`, then `cd apps/web && bun test test`.

Technology logos are served locally from `apps/web/public/icons/`, with one shared theme-aware icon component for builder cards and badges. Assets were sourced from the original Better-T-Stack icon collection (`https://r2.better-t-stack.dev/icons/`); the Prisma mark comes from Simple Icons (`https://cdn.simpleicons.org/prisma/2D3748`). Brand marks remain the property of their respective owners. Runtime icon loading does not depend on an external CDN.

## Development

```bash
# Clone the repository
git clone https://github.com/ziyu/xstack.git
cd xstack

# Install dependencies
bun install

# Build and run the local CLI
bun run build:cli
bun run cli --help

# Start CLI development
bun dev:cli

# Start website development
bun dev:web
```

The website requires `NEXT_PUBLIC_CONVEX_URL` for a configured Convex deployment. Set it in `apps/web/.env.local` before running `bun dev:web`.

### Local Convex development

No Convex cloud account is required for local development. In one terminal, run:

```bash
bun run --filter @xstack/backend dev
```

On first setup, the CLI creates `packages/backend/.env.local` and a real local database under `packages/backend/.convex/`. Set `apps/web/.env.local` to the client URL printed by Convex (normally `NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210`), then run `bun dev:web` in another terminal. Keep the backend running while using the site.

The OSS statistics component requires `GITHUB_ACCESS_TOKEN` before functions can deploy. From `packages/backend`, configure a GitHub token without putting it in shell history:

```bash
# Reuse an authenticated GitHub CLI account for local development only.
gh auth token | bunx --no-install convex env set GITHUB_ACCESS_TOKEN
# Set a separate random signing secret if using GitHub webhooks.
bunx --no-install convex env set GITHUB_WEBHOOK_SECRET
# Verify the deployed backend.
bunx --no-install convex run healthCheck:get
```

Deployment secrets belong in Convex's environment, not `NEXT_PUBLIC_*` variables. Local deployment data and `.env.local` files must remain ignored by Git. A new database contains no testimonials or analytics events; empty lists and zero counts are expected until real data is added. This setup does not create or deploy a production cloud project.

`next-themes@0.4.6` has a Bun patch in `patches/` for React's client-rendered script warning. Its theme bootstrap remains in SSR output and the hydration pass; client-only mounts use the existing theme effect instead of creating an inert script element. `bun install` applies the patch automatically. After dependency patches change, restart the Next.js development server. Browser smoke checks cover client remounts, persisted dark-theme SSR, hydration, and system-theme changes.

### Generated-project verification (2026-10-19)

Validated the default shell, `starter`, and `saas-global` using Next.js, SQLite, Drizzle, and Bun 1.3.14 on Node.js 26.11.1. All three installed dependencies, passed `bun run check-types`, built with `bun run build`, and started with the generated web workspace's `bun run start --port <port>` command. The auth presets also generated and applied SQLite migrations.

- `starter`: browser signup, logout, login, profile updates, session persistence after reload, and anonymous dashboard protection passed against the production server.
- `saas-global`: verified email using the documented development-console delivery, checked admin/user separation, granted 125 credits, rejected a 200-credit deduction without changing the balance, and rendered English/Chinese pages. After restarting in production, login, existing sessions, access restrictions, and the persisted balance still worked.
- Reproduction commands now target `xstack` for Bun, pnpm, and npm. Regression tests replay their generated arguments and compare the resulting stack and module configuration.
- Template Builder: SMTP + Polar, OAuth disabled, Chinese locale, and 50 signup credits survived URL reload, saved preferences, and sharing. The copied command generated a project that installed, typechecked, migrated SQLite, built, and served its Chinese homepage and login page in production mode. This did not verify live SMTP or Polar transactions.
- Builder icons: all 50 local SVG sources decoded in the browser; light/dark backend cards and selected badges loaded without requests to the former icon CDN.

Run the command regressions with `bun run build:cli && bun test apps/cli/test/cli-output.test.ts packages/template-generator/test`.

Limits: no live OAuth, Resend delivery, payment checkout, signed payment webhook, PostgreSQL, or deployment-provider certification was performed. `saas-global` requires real email credentials for production signup verification; without them, production email delivery is rejected. Development prints verification links to the server console. Root `db:generate` / `db:migrate` tasks require a terminal because Turbo marks them interactive; automation can run those scripts directly in `packages/db`.

## Want to contribute?

Please read the Contribution Guide first and open an issue before starting new features to ensure alignment with project goals.

- Docs: [`./apps/web/content/docs/contributing.mdx`](./apps/web/content/docs/contributing.mdx)
- Repo guide: [`./.github/CONTRIBUTING.md`](./.github/CONTRIBUTING.md)

## Star History

<a href="https://www.star-history.com/#ziyu/xstack&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=ziyu/xstack&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=ziyu/xstack&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=ziyu/xstack&type=Date" />
 </picture>
</a>
