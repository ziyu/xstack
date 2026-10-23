# Live generated-project tests

Run from the repository root. These tests create disposable projects and databases, install through the actual CLI, run generated commands, and exercise the app in Chromium. They are not connected to CI or the release workflow.

```sh
bun run build:cli
cd apps/cli && bunx playwright install chromium && cd ../..
bun run test:live plan --where '{"frontend":["tanstack-router"],"backend":"hono","runtime":"bun","database":"sqlite","orm":"drizzle","dbSetup":"none","api":"trpc","auth":"better-auth","webDeploy":"none","serverDeploy":"none","packageManager":"bun","addons":[]}'
```

Replace `plan` with `run` to execute that selection. Remove selection fields to enumerate their valid alternatives. An empty selection enumerates all supported core stack choices, frontend/native pairs, addon subsets, and example subsets using the existing compatibility rules. It does **not** yet enumerate addon-specific options or automatic database-setup login flows.

The complete matrix has millions of core cases before addon and example subsets. Use explicit filters for manageable batches; a successful batch is not complete-matrix certification.

`--limit N` bounds a run for development; a limited run reports incomplete coverage and exits nonzero. Zero matching cases also exits nonzero. An enumerated case only passes after its runtime checks and resource cleanup succeed. Missing adapters or credentials are blocked, never passed.

### Native Cloudflare D1 and R2 binding

Generate a disposable Next/self/Drizzle project with `--web-deploy cloudflare --database sqlite --db-setup d1`, storage provider `r2-binding`, and compatible full providers (`email=resend`, `sms=twilio`, `payment=stripe`). Explicit Node-only provider selections are errors, not automatic substitutions. From the generated root, run `db:generate` then `db:migrate:local`. Set the app origin/credentials in `.env`, copy them to `apps/web/.dev.vars`, and run `build:cloudflare` then `preview:cloudflare` from `apps/web`. This uses real local workerd/D1/R2 without a Cloudflare account; it does not verify deployed cloud IAM or paid providers.

For an auth+storage fixture under `apps/cli/.smoke`, run `bun apps/cli/live-tests/storage.ts <fixture> http://localhost:8787 r2-binding`. This checks local attachment bytes, ownership, mutation origins, upload bounds and deletion. Full fixtures additionally require their configured verification-email and Turnstile signup flow; do not disable those controls to claim full-preset acceptance. Full end-to-end module tests remain separate from this focused storage check.


## Accounts

Supply credentials in the local process environment or use the provider CLI's existing login. Do not commit credentials here.

Account-free Neon claims use a separate context file per case, so parallel batches do not link the repository to a disposable project.

| Provider                                    | Runner input                                                                  | Status                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Neon                                        | Optional `NEON_API_KEY`, `XSTACK_LIVE_NEON_ORG_ID`, `XSTACK_LIVE_NEON_REGION` | Account-free claimable project, or authenticated API project; deleted after the case                |
| Prisma Postgres                             | No account; optional `XSTACK_LIVE_PRISMA_POSTGRES_REGION`                     | Disposable database expires after two hours                                                         |
| Vercel                                      | Existing `vercel login`; `XSTACK_LIVE_VERCEL_SCOPE`                           | Disposable project; production and preview deployments; browser checks and runtime logs implemented |
| Cloudflare through Alchemy                  | Project-local Alchemy profile; `CLOUDFLARE_ACCOUNT_ID`                        | Adapter needs an authenticated live run; Wrangler login alone is insufficient                       |
| Clerk, Polar sandbox, Convex                | Dedicated test accounts to be added later                                     | Blocked; provider-specific verification still required                                              |
| Supabase, Turso, PlanetScale, MongoDB Atlas | Dedicated test accounts to be added later                                     | Blocked; database provisioners still required                                                       |

Vercel function cases require the Node runtime; Bun remains a supported package manager. The runner verifies production and preview on its disposable project. It creates a deployment-protection bypass secret scoped to that project and verifies that preview access without it is denied. Authorization exchanges the bypass header for Vercel's scoped cookie at each deployment origin, without following bootstrap redirects. Subsequent requests use cookies, so external resources do not receive the bypass header. Nuxt dashboards are also checked with JavaScript disabled to verify server-rendered sessions and private RPC data.

## Verification and current limits

- The CLI must save the requested selections in `xstack.jsonc`; silently selecting a default is a failure.
- Generated dependencies install, then the project typechecks. Local cases build and exercise both the generated development and production servers.
- SQLite and Neon cases generate and apply a migration, repeat it to check idempotence, then run `db:push`. Prisma generates its client and initial migration SQL with the documented `migrate diff` command before applying it.
- Browser checks cover rendering, API health, Better Auth signup/login/logout, session persistence after reload, protected navigation, and todo create/update/delete with reloads. Browser crashes, hydration mismatches, failed requests, API errors, and incorrect API origins fail the case.
- Direct SQLite/PostgreSQL queries verify signup and todo changes. The same account and a saved todo must survive the development-to-production restart or Vercel production-to-preview deployment. Server-only cases verify HTTP auth, protected RPC calls and todo CRUD. PWA cases check the manifest, icons, service worker, offline navigation, and exclusion of auth/RPC responses from caches.
- Native devices, Docker, mixed deployment providers, AI, payments, and unsupported addons are explicitly blocked until their runtime checks exist.
- Live tests exposed a Next.js public environment replacement failure, login hydration errors, Nuxt session hydration and early form interaction failures, cold dependency optimization failures, and an empty Prisma migration directory. Fixes must pass freshly generated cases; a passing retry alone does not resolve a finding.
- Framework-specific browser selectors still need validation across the full matrix. A passing TanStack Router case does not certify other frameworks.

## Results, resume, and cleanup

The runner prints its directory under `apps/cli/.smoke/live/`. It contains SQLite results, generated projects, redacted command logs, browser traces, and screenshots for failures. Generated `.env` files and browser traces can contain disposable test credentials; the directory is private and ignored by Git.

```sh
bun run test:live report --directory apps/cli/.smoke/live/RUN_ID
bun run test:live cleanup --directory apps/cli/.smoke/live/RUN_ID
```

Repeat the same `run --where ...` command to resume. Passed cases are skipped; use `--retry-failed` to retry failures. Blocked and interrupted cases are revisited. The identity includes the built CLI, CLI source used by the runner, generated-template bundle, shared types, runner source, lockfile, commit, and filter; changed inputs require a new run directory.

Cleanup normally runs after each case. `--retain-failed` preserves failed deployments for investigation; clean them with the command above. Interruptions retain resource records so cleanup can resume. A failed cleanup keeps the case failed and the resource pending. Unconfirmed Vercel creation intents require inspecting the create log/account before reconciliation; cleanup will not delete an unconfirmed project by name.

Only one process can mutate a given run directory. `runner.lock` contains its PID. After an ungraceful kill, confirm that process is gone before removing the stale lock. Local cases also refuse to use occupied framework ports.

With Chromium installed, the optional credential-scoping regression checks browser, JavaScript-disabled SSR and HTTP contexts against local protected and external origins:

```sh
XSTACK_LIVE_BROWSER_TESTS=1 bun test apps/cli/live-tests/protection.test.ts
```

## Phone OTP checks

Generate a disposable Next.js/Drizzle/SQLite project under `apps/cli/.smoke` with `auth`, `sms`, and optionally `credits`. Install its dependencies and apply its database schema. Start its development server with `SMS_DELIVERY_MODE=console`, a matching `BETTER_AUTH_URL`, and capture server output to a private log. Then run:

```sh
bun apps/cli/live-tests/phone.ts apps/cli/.smoke/phone-app http://localhost:3001 /absolute/path/to/phone-server.log
```

This exercises real HTTP auth endpoints and the generated SQLite database, not a provider API. It resets rate limits and expires challenges, so it refuses projects outside `.smoke` and non-loopback origins. It checks phone signup/session, resend cooldown, expiry, bounded attempts, concurrent send/verification, replay rejection and unverified phone assignment. Console OTPs in the log are sensitive; remove the disposable project and log after testing. This check does not establish real SMS delivery.

Generated install/typecheck/build samples for all three providers are selected with `XSTACK_BUILD_SAMPLES=1 XSTACK_BUILD_SAMPLE_FILTER=product-phone bun test apps/cli/test/generated-builds.test.ts`.

## WeChat protocol checks

Generate an `auth` + `auth:wechat` Next.js/SQLite fixture under `apps/cli/.smoke`, install dependencies, and apply its schema. Run `bun apps/cli/live-tests/wechat.ts apps/cli/.smoke/wechat-app` to exercise the generated auth handler and database with a local provider-response fixture. This checks authorization URL parameters, state/cookie binding, expiration, replay, synthetic-email/admin isolation, returning login, rejected external redirects and forged ID tokens. It does not contact WeChat or validate a real scan. Use an approved website AppID, AppSecret and reachable callback domain for live-provider acceptance. Never report this fixture as real WeChat verification.

## Domestic payment protocol checks

Generate an auth/payment/credits SQLite fixture under `apps/cli/.smoke` with `auth:none` and `payment:wechat,alipay`, install dependencies, and apply its schema to `<fixture>/local.db`. Run `bun apps/cli/live-tests/payments.ts apps/cli/.smoke/<fixture>`. It exercises real generated payment services and credit ledger with ephemeral RSA keys and a controlled WeChat HTTP boundary. Checks cover signed checkout/response, Alipay page URL signatures, bad signatures/timestamps/key IDs, wrong app/merchant/amount/currency, provider/order binding, private QR ownership and repeat notifications granting credits once.

This does not contact payment providers or transfer money. Live acceptance still requires approved Native/desktop payment products, matching credentials, reachable HTTPS notifications, a real scan/payment and settlement reconciliation. Generated build samples use `XSTACK_BUILD_SAMPLES=1 XSTACK_BUILD_SAMPLE_FILTER=product-domestic-payment bun test apps/cli/test/generated-builds.test.ts`.

## Private object storage checks

Generate a native SQLite project under `apps/cli/.smoke` with `--features storage --providers auth:none storage:oss` or `storage:cos`. Install, apply the database schema, configure a dedicated private test bucket and start the app with `BETTER_AUTH_URL` matching its loopback origin. Run `bun apps/cli/live-tests/storage.ts apps/cli/.smoke/<fixture> http://localhost:<port>`. This creates disposable accounts and uploads/deletes files; never use production credentials. It checks authentication, cross-origin rejection, empty/oversized/duplicate file rejection, ownership isolation, signed attachment redirects and deletion.

The provider SDK may be intercepted at its HTTP boundary for local protocol verification, but that is not cloud acceptance. Real acceptance must confirm private ACL/IAM, downloaded bytes, expiry and deletion against a dedicated OSS/COS bucket. Avoid interceptors that replace global Fetch/Request/Headers: they can interfere with Better Auth SSR; the local SDK fixture used HTTP-only interception. Build matrix: `XSTACK_BUILD_SAMPLES=1 XSTACK_BUILD_SAMPLE_FILTER=product-storage bun test apps/cli/test/generated-builds.test.ts` covers both providers with SQLite/PostgreSQL.

## Captcha HTTP protocol checks

Generate native Next.js/SQLite `captcha` (optionally full preset) under `apps/cli/.smoke`, install dependencies and apply schema to `local.db`. Set `TURNSTILE_SITE_KEY=captcha-fixture-site`, `TURNSTILE_SECRET_KEY=captcha-fixture-secret`, `TURNSTILE_TEST_MODE=false`, and `BETTER_AUTH_URL` to the exact loopback application origin. If email is selected, configure a disposable email delivery fixture too; successful signup must still execute its real email/event integrations.

Start the signed local protocol server separately:

```sh
CAPTCHA_FIXTURE_SIGNING_KEY=disposable-local-signing-key-32-characters bun apps/cli/live-tests/captcha-provider.ts 4399
```

Start the generated Next development or production server with `CAPTCHA_FIXTURE_ORIGIN=http://127.0.0.1:4399` and `NODE_OPTIONS="--import /absolute/repo/apps/cli/live-tests/captcha-preload.mjs"`. The preload refuses non-`.smoke` working directories and non-loopback fixture addresses, redirects only the exact Siteverify URL, and is not copied into generated code. Run:

```sh
bun apps/cli/live-tests/captcha.ts apps/cli/.smoke/captcha-app http://127.0.0.1:3001 http://127.0.0.1:4399
```

This exercises generated auth via HTTP and checks the actual SQLite user table: missing/forged tokens, host/action/time mismatch, single-use replay, trusted Origin, account creation, login/session, and public-only configuration. To obtain tokens for combined module checks, POST `{ "action": "signup", "hostname": "127.0.0.1" }` to the fixture's `/issue` endpoint; send the returned `token` as `x-captcha-token` and the exact application Origin with auth requests. Browser protocol checks may replace only the external widget script with a local widget that requests signed fixture tokens using the supplied `render` action; they must not bypass the server hook. This is **not real Cloudflare validation**. Live acceptance uses real keys, browser-issued tokens, expiry/replay cases and a deployed hostname. Published dummy keys are only allowed with explicit local development test mode and are not proof of production binding/replay protection.

## P3 combined verification

Build samples: `XSTACK_BUILD_SAMPLES=1 XSTACK_BUILD_SAMPLE_FILTER=product-p3 bun test apps/cli/test/generated-builds.test.ts` covers full SQLite/PostgreSQL, standalone AI/SEO/blog/affiliate/captcha, and S3/R2 API projects.

- `bun apps/cli/live-tests/ai.ts <fixture> <fixture>/local.db`: generated AI and real SQLite ledger; concurrent replay, insufficient credits, definite/async failure refunds, cancellation, image/video bytes and ambiguous-outcome safety. External model HTTP is intercepted; no paid generation occurs.
- `bun apps/cli/live-tests/affiliate.ts <fixture>`: actual auth, signed Stripe notifications and credit ledger; attribution, private-field rejection, self-referral, concurrent/repeated settlement, retry recovery and renewal exclusion.
- `CONTENT_ADMIN_COOKIE=… CONTENT_USER_COOKIE=… bun apps/cli/live-tests/content.ts <fixture> <origin>`: actual admin/public HTTP CRUD, drafts, locale translations, optimistic revisions, safe Markdown/JSON-LD and live sitemap. Supply real sessions from the captcha/email-protected auth flow.

Cloudflare: generate full with D1 and `storage:r2-binding`, install, `db:generate`, `db:migrate:local`, then `build:cloudflare` and `preview:cloudflare`. Local workerd uses real D1/R2. Combined provider tests may intercept exact outbound service URLs in a throwaway Miniflare harness; all other outbound calls must be rejected. This is not live cloud/model/payment acceptance. Do not put fixture transports or credentials into generated production code.

## Module addition checks

Run `bun apps/cli/live-tests/module-add.ts apps/cli/.smoke/<new-fixture>` against an absent disposable path. It creates an auth project through the real CLI API, customizes its homepage/guidance/environment, dry-runs and applies credits, verifies repeated no-op behavior, then appends payment and checks local changes and secrets survived. No provider accounts are contacted. Install and run all workspace typechecks/build in that fixture afterward; review and apply its schema only to a disposable database.

MCP coverage in `apps/cli/test/mcp.test.ts` exercises the same plan/apply APIs. Conflict, baseline adoption, interrupted-write recovery and symlink rejection must also be exercised when changing the merge engine. Do not use helper-source snapshots as evidence of safe project evolution.

## Selected validation run

The [2026-10-02 verification record](./verification-2026-10-02.md) lists the 19 local, five Postgres, and two Vercel fixtures that passed, including production and protected preview stages.

The [official documentation and type audit](./docs-audit-2026-10-02.md) explains the reviewed changes, upstream sources and corrections to verified PR findings.
