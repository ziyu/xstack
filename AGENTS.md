# Repository Guidelines

## Project Structure & Module Organization

This repo is a Bun + Turborepo monorepo.

- `apps/cli`: published CLI (`xstack`), with source in `apps/cli/src` and tests in `apps/cli/test`.
- `apps/web`: Next.js docs/site (`apps/web/src`, `apps/web/content/docs`, `apps/web/public`).
- `packages/template-generator`: template generation engine used by the CLI.
- `packages/types`: shared schemas/types.
- `packages/backend`: Convex backend used by web features.
- `plugin/`: installable agent plugin (Claude Code + Codex) — skills, commands, and MCP wiring; published via the root marketplaces (`.claude-plugin/`, `.agents/plugins/`).

## Build, Test, and Development Commands

- `bun install`: install workspace dependencies.
- `bun dev:cli`: watch-build CLI package.
- `bun dev:web`: run web app locally (`next dev --port 3333`).
- `bun build`: build all packages/apps through Turbo.
- `bun build:cli`: build only the CLI target.
- `bun run check`: format + lint (`oxfmt . && oxlint .`).
- `cd apps/cli && bun run test`: run CLI integration tests.

## Coding Style & Naming Conventions

- Language: TypeScript (strict mode enabled across projects).
- Modules: ESM-first (`"type": "module"` where applicable).
- Formatting/linting: `oxfmt` and `oxlint`; run `bun run check` before committing.
- File naming: prefer kebab-case files (for example `database-setup.ts`).
- Symbols: `camelCase` for functions/variables, `PascalCase` for types/components.
- Keep feature logic near domain folders (`helpers`, `utils`, `template-handlers`).

## Error Handling Conventions

- In CLI code, prefer `better-result` over ad-hoc `try/catch` for recoverable flows.
- Return typed `Result<T, E>` and use `Result.ok`, `Result.err`, `Result.try`, and `Result.tryPromise`.
- Reuse domain errors from `apps/cli/src/utils/errors.ts` (`CLIError`, `ProjectCreationError`, `UserCancelledError`) and convert thrown prompt errors at boundaries.

## Template Authoring (Handlebars)

- Templates live in `packages/template-generator/templates` and use helpers from `packages/template-generator/src/core/template-processor.ts` (`eq`, `ne`, `and`, `or`, `includes`).
- For conditional ORM-specific output, use helper form with quoted values:
  - `{{#if (eq orm "prisma")}}`
  - `{{else if (eq orm "drizzle")}}`
  - `{{/if}}`
  - Example: `packages/template-generator/templates/packages/infra/alchemy.run.ts.hbs`.
- When files must contain literal `{{ ... }}` (Vue/JSX/template syntax), escape opening braces as `\{{` in `.hbs` files so Handlebars does not evaluate them.
  - Example: `packages/template-generator/templates/frontend/nuxt/app/pages/index.vue.hbs`.

## Testing Guidelines

- Use `bun:test` for integration tests in `apps/cli/test` and `apps/web/test`.
- Verify behavior through CLI, MCP, and oRPC interfaces and generated-project installation, typechecking, and builds.
- Reuse shared setup utilities in `apps/cli/test/setup.ts` for disposable project directories.
- Run live browser, database, and deployment checks locally through `apps/cli/live-tests`; keep them out of CI.
- Do not add isolated unit tests, mocked helper tests, or assertions that copy static template source.

## Commit & Pull Request Guidelines

- Use Conventional Commits with scope, matching history:
  - `feat(cli): ...`, `fix(web): ...`, `docs(cli): ...`
- Open an issue/discussion before major feature work.
- PRs should include:
  - clear summary,
  - linked issue (if applicable),
  - verification steps run (`bun run check`, relevant tests),
  - screenshots/GIFs for web UI changes.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `ziyu/xstack` using the `gh` CLI.

### Triage labels

The canonical triage roles map directly to same-named GitHub labels.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
