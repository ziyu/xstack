# Contributing to xstack

Thank you for your interest in contributing to xstack! This document provides guidelines and setup instructions for contributors.

> **⚠️ Important**: Before starting work on any new features or major changes, please open an issue first to discuss your proposal and get approval. We don't want you to waste time on work that might not align with the project's direction or get merged.

## Project Structure

This repository is organized as a monorepo containing:

- **CLI**: [`apps/cli`](../apps/cli) - The scaffolding CLI tool (`xstack`)
- **Website**: [`apps/web`](../apps/web) - Template Builder and documentation
- **Generator**: [`packages/template-generator`](../packages/template-generator) - Shared module manifests, resolver and templates

## Development Setup

### Prerequisites

- Node.js (lts)
- Bun (recommended)
- Git

### Initial Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/ziyu/xstack.git
   cd xstack
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

### CLI Development

1. **Navigate to CLI directory**

   ```bash
   cd apps/cli
   ```

2. **Link the CLI globally** (optional, for testing anywhere in your system)

   ```bash
   bun link
   ```

   Now you can use `xstack` from anywhere in your system.

3. **Start development server**

   ```bash
   bun dev
   ```

   This runs tsdown build in watch mode, automatically rebuilding on changes.

4. **Test the CLI**
   Now go to anywhere else in your system (maybe like a test folder) and run:
   ```bash
   xstack
   ```
   This will run the locally installed CLI.

### Web Development

1. From the repository root, run `bun install` and `bun run build:cli`.
2. Start the local Convex backend in one terminal: `bun run --filter @xstack/backend dev`. A local deployment does not require a Convex cloud account.
3. Copy its client URL into `apps/web/.env.local`, for example `NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210`.
4. The statistics component requires a GitHub token. In `packages/backend`, use `gh auth token | bunx --no-install convex env set GITHUB_ACCESS_TOKEN` with an authenticated GitHub CLI, or enter a token through `bunx --no-install convex env set GITHUB_ACCESS_TOKEN`. Configure `GITHUB_WEBHOOK_SECRET` similarly if using webhooks. Never commit secrets or `.convex/` state.
5. In another terminal at the repository root, run `bun dev:web` and open `http://localhost:3333/new`.

The Template Builder reads product options from the shared module catalog. Update the schema, URL parsers, command generation, file preview, and tests together when changing that contract. Technology icons live in `apps/web/public/icons/`; both builder cards and badges use `src/components/ui/tech-icon.tsx`. Add matching theme variants locally rather than introducing an external CDN dependency.

Keep `@xstack/template-generator/modules` browser-safe: module manifests contain a stack-renderer key, while the generation pipeline owns the renderer implementation. Do not import template processing, filesystem utilities, or Node built-ins from the catalog/resolver entry point. `packages/template-generator/test/browser-catalog.test.ts` checks that this entry bundles for browsers.

The website loads Geist Sans and Geist Mono through `next/font/local` from `apps/web/assets/fonts/`. These unmodified variable fonts come from the official `geist@1.8.2` package; retain the accompanying SIL Open Font License. Website compilation must not require downloading Google Fonts CSS.

### Focused Verification

```bash
# From the repository root
bun run build:cli
bun test apps/cli/test packages/template-generator/test
bun run --filter web check-types

# From apps/web
bun test test
```

Browser-check presets, provider changes, locale/credit options, saved/shared URLs, file preview, mobile layout, and light/dark icons. A passing preview is not proof that a generated app runs: install, build, and launch a representative output when changing templates. Real email, OAuth, or payment checks require provider credentials and must not be reported as passed without them.

## Contribution Guidelines

### Standard Contribution Steps

1. **Create an issue** (if one doesn't exist)
   - Describe the bug or feature request
   - Include steps to reproduce (for bugs)
   - Discuss the proposed solution

2. **Fork the repository**
   - Click the "Fork" button on GitHub
   - Clone your fork locally

3. **Create a feature branch**

   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

4. **Make your changes**
   - Follow the existing code style
   - Update documentation as needed

5. **Test and format your changes** (see Testing section below)

6. **Commit your changes**

   ```bash
   git add .
   git commit -m "feat(web): add your feature description"
   # or
   git commit -m "fix(cli): fix your bug description"
   ```

7. **Push to your fork**

   ```bash
   git push origin feature/your-feature-name
   ```

8. **Create a Pull Request**
   - Link to the related issue
   - Describe your changes

### Testing

**Before committing, make sure to test your changes:**

```bash
# For CLI changes
cd apps/cli
bun dev
bun run test

# Lint and format files (from root, uses oxlint and oxfmt)
bun run check
```

- **Manual testing**: Test your changes manually to ensure everything works as expected
- For CLI changes: Test with different configurations and options
- For web changes: Ensure the site builds and displays correctly

## Commit Conventions

Use conventional commit messages with the appropriate scope:

- `feat(cli): add new CLI feature`
- `fix(cli): fix CLI bug`
- `feat(web): add new web feature`
- `fix(web): fix web bug`
- `chore(web): update dependencies`

## Getting Help

- Open an issue for bugs or feature requests
- Join discussions for questions or ideas
- Check existing issues and PRs for similar work
- Join our [Discord](https://discord.gg/ZYsbjpDaM5) if you have any problems

## License

By contributing to xstack, you agree that your contributions will be licensed under the MIT License.
