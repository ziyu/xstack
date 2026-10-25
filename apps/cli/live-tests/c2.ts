import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { SQL } from "bun";
import { z } from "zod";

import {
  c2ApplicationEnvironment,
  readC2Applications,
  type C2Applications,
} from "./c2-applications";
import { c2Cases, c2Input, type C2Case } from "./c2-cases";
import { C2Database, exerciseC2, type C2Result } from "./c2-http";
import { Commands } from "./command";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    case: { type: "string", default: "all" },
    directory: { type: "string" },
  },
});
const action = positionals[0] ?? "plan";
assert.ok(
  ["plan", "prepare", "check", "runtime", "run", "report", "cleanup"].includes(action),
  "Expected plan|prepare|check|runtime|run|report|cleanup",
);
const root = path.resolve(import.meta.dir, "../../..");
const smoke = path.join(root, "apps/cli/.smoke");
const directory = path.resolve(values.directory ?? path.join(smoke, "c2"));
assert.ok(
  directory.startsWith(smoke + path.sep),
  "C2 artifacts must be strictly inside apps/cli/.smoke",
);
const selected = c2Cases.filter(
  (test) => values.case === "all" || values.case!.split(",").includes(test.id),
);
assert.ok(selected.length, "No matching C2 cases");
if (values.case !== "all")
  for (const id of values.case!.split(","))
    assert.ok(
      c2Cases.some((test) => test.id === id),
      `Unknown C2 case: ${id}`,
    );
const signal = new AbortController();
for (const name of ["SIGINT", "SIGTERM"] as const) process.once(name, () => signal.abort());
type Prepared = {
  id: string;
  project: string;
  databaseUrl: string;
  env: Record<string, string>;
  preparedAt: string;
};
type CaseReport = {
  id: string;
  action: string;
  status: "passed" | "failed" | "prepared" | "checked";
  results: C2Result[];
  detail?: string;
};
const reports: CaseReport[] = [];
const plan = selected.map((test) => ({ ...test, input: c2Input(test, `c2-${test.id}`) }));
if (action === "plan") {
  console.log(
    JSON.stringify(
      {
        directory,
        cases: plan,
        requirements: [
          "Built CLI and generated template bundles (bun run build:cli)",
          "Bun, Node, package registry access",
          "Exclusive loopback application ports from generated applications.json, plus fixture port 4399",
          "Postgres: empty disposable database via C2_DATABASE_URL and C2_DISPOSABLE_POSTGRES=1",
        ],
        evidence: {
          email: "development console hooks",
          sms: "development console hooks",
          captcha: "local Siteverify protocol fixture",
          oauth: "authorization/state + isolated WeChat exchange; no cloud credential verification",
        },
      },
      null,
      2,
    ),
  );
} else if (action === "report") {
  for (const test of selected)
    reports.push(JSON.parse(await readFile(path.join(directory, test.id, "result.json"), "utf8")));
  console.log(JSON.stringify(reports, null, 2));
  if (reports.some((report) => report.status === "failed")) process.exitCode = 1;
} else {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  assert.ok(
    (await realpath(directory)).startsWith((await realpath(smoke)) + path.sep),
    "Symlink escapes are forbidden",
  );
  const lock = await open(path.join(directory, "runner.lock"), "wx", 0o600);
  await lock.writeFile(String(process.pid));
  try {
    for (const test of selected) {
      signal.signal.throwIfAborted();
      const caseDirectory = path.join(directory, test.id);
      const manifestPath = path.join(caseDirectory, "prepared.json");
      const project = path.join(caseDirectory, `c2-${test.id}`);
      await mkdir(caseDirectory, { recursive: true, mode: 0o700 });
      const report: CaseReport = { id: test.id, action, status: "failed", results: [] };
      const commands = new Commands(caseDirectory, signal.signal);
      const save = async () => {
        await writeFile(path.join(caseDirectory, "result.json"), JSON.stringify(report, null, 2), {
          mode: 0o600,
        });
      };
      const step = async (name: string, work: () => Promise<void>) => {
        try {
          await work();
          report.results.push({ name, status: "passed" });
        } catch (error) {
          report.results.push({ name, status: "failed", detail: commands.redact(String(error)) });
          throw error;
        } finally {
          await save();
        }
      };
      let database: C2Database | undefined;
      try {
        if (action === "cleanup") {
          const prepared = JSON.parse(await readFile(manifestPath, "utf8")) as Prepared;
          assert.equal(prepared.project, project);
          if (test.database === "postgres")
            await cleanPostgres(prepared.databaseUrl, caseDirectory);
          await rm(project, { recursive: true, force: true });
          await rm(manifestPath);
          report.status = "passed";
          report.results.push({ name: "cleanup-owned-project-and-database", status: "passed" });
        } else {
          let prepared: Prepared;
          let resolved: C2Applications;
          if (action === "prepare" || action === "run") {
            await assertAbsent(
              project,
              "Use a new --directory or cleanup; refusing to reuse/overwrite an existing generated project",
            );
            const databaseUrl =
              test.database === "sqlite"
                ? `file:${project}/local.db`
                : await claimPostgres(caseDirectory);
            prepared = {
              id: test.id,
              project,
              databaseUrl,
              env: environment(test, databaseUrl),
              preparedAt: new Date().toISOString(),
            };
            // Persist ownership before generation, so interrupted prepare remains cleanable.
            await writeFile(manifestPath, JSON.stringify(prepared, null, 2), { mode: 0o600 });
            commands.secret(databaseUrl);
            await step("generate-real-cli", async () => {
              await commands.run("generate", caseDirectory, "node", [
                path.join(root, "apps/cli/dist/cli.mjs"),
                "create-json",
                "--json",
                JSON.stringify(c2Input(test, path.basename(project))),
              ]);
            });
            resolved = await readC2Applications(project);
            prepared.env = c2ApplicationEnvironment(
              resolved.targets.backend,
              resolved.targets,
              prepared.env,
            );
            await writeFile(manifestPath, JSON.stringify(prepared, null, 2), { mode: 0o600 });
            await step("write-disposable-environment", async () => {
              for (const app of resolved.applications) {
                const appEnv = c2ApplicationEnvironment(app, resolved.targets, prepared.env);
                await writeFile(
                  path.join(project, app.directory, ".env"),
                  Object.entries(appEnv)
                    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
                    .join("\n") + "\n",
                  { mode: 0o600 },
                );
              }
              await writeFile(
                path.join(project, "packages/db/.env"),
                `DATABASE_URL=${JSON.stringify(databaseUrl)}\n`,
                { mode: 0o600 },
              );
            });
            await step("install", async () => {
              const extra = z
                .array(z.string())
                .parse(JSON.parse(process.env.C2_INSTALL_ARGS ?? "[]"));
              await commands.run("install", project, "bun", ["install", ...extra], {
                ...prepared.env,
                NODE_ENV: "development",
              });
            });
            await step("database-generate-migrate-repeat-push", async () => {
              for (const script of [
                "db:generate",
                "db:migrate:deploy",
                "db:migrate:deploy",
                "db:push",
              ])
                await commands.run(
                  script.replaceAll(":", "-"),
                  path.join(project, "packages/db"),
                  "bun",
                  ["run", script],
                  prepared.env,
                );
            });
          } else {
            prepared = JSON.parse(await readFile(manifestPath, "utf8")) as Prepared;
            assert.equal(prepared.id, test.id);
            assert.equal(prepared.project, project);
            resolved = await readC2Applications(project);
          }
          if (action === "check" || action === "run") {
            await step("generated-typecheck", async () => {
              await commands.run("check-types", project, "bun", ["run", "check-types"], {
                ...prepared.env,
                NODE_ENV: "production",
              });
            });
            await step("generated-build", async () => {
              await commands.run("build", project, "bun", ["run", "build"], {
                ...prepared.env,
                NODE_ENV: "production",
              });
            });
          }
          if (action === "runtime" || action === "run") {
            prepared.env.ADMIN_EMAILS = `admin-c2-${Date.now()}@example.test`;
            await step("split-client-server-dependency-isolation", async () => {
              for (const app of resolved.runtime.filter(
                (app) => app !== resolved.targets.backend,
              )) {
                const packageJson = JSON.parse(
                  await readFile(path.join(project, app.directory, "package.json"), "utf8"),
                ) as { dependencies?: Record<string, string> };
                for (const dependency of Object.keys(packageJson.dependencies ?? {}))
                  assert.ok(
                    !/\/(?:db|auth|sms|email|captcha|events)$/.test(dependency),
                    `${app.id} imports server workspace ${dependency}`,
                  );
                const contents = await readFile(path.join(project, app.directory, ".env"), "utf8");
                assert.doesNotMatch(contents, /SECRET|TOKEN|PASSWORD|DATABASE_URL/);
              }
            });
            assert.ok(
              !resolved.runtime.some((app) => app.port === 4399),
              "Application port conflicts with captcha fixture",
            );
            for (const port of [...resolved.runtime.map((app) => app.port), 4399])
              await available(port);
            const fixture = commands.start(
              "captcha-fixture",
              root,
              "bun",
              [path.join(import.meta.dir, "captcha-provider.ts"), "4399"],
              { CAPTCHA_FIXTURE_SIGNING_KEY: randomBytes(32).toString("hex") },
            );
            await ready("http://127.0.0.1:4399/siteverify", fixture, signal.signal, false);
            let output = "";
            const preload = pathToFileURL(path.join(import.meta.dir, "c2-preload.mjs")).href;
            const runtimeEnv = {
              NODE_ENV: "development",
              HOST: "127.0.0.1",
              HOSTNAME: "127.0.0.1",
              NITRO_HOST: "127.0.0.1",
              CAPTCHA_FIXTURE_ORIGIN: "http://127.0.0.1:4399",
              NODE_OPTIONS: `--import=${preload}`,
            };
            for (const app of resolved.runtime) {
              const appDirectory = path.join(project, app.directory);
              const runtime = commands.start(
                `${app.id}-development`,
                appDirectory,
                "bun",
                ["run", "dev", ...app.devArgs],
                {
                  ...runtimeEnv,
                  ...c2ApplicationEnvironment(app, resolved.targets, prepared.env),
                  PORT: String(app.port),
                  NITRO_PORT: String(app.port),
                },
              );
              runtime.child.all?.on("data", (chunk: Buffer | string) => {
                output += chunk.toString();
              });
              await ready(
                `${app.origin}${app.roles.some((role) => role === "web-frontend" || role === "admin") ? "/en/login" : "/"}`,
                runtime,
                signal.signal,
              );
            }
            database = new C2Database(prepared.databaseUrl);
            await exerciseC2({
              targets: resolved.targets,
              database,
              fixture: "http://127.0.0.1:4399",
              administrator: prepared.env.ADMIN_EMAILS!,
              transcript: () => output,
              results: report.results,
              save,
              signal: signal.signal,
            });
            await commands.stopAll();
            // Standalone protocol fixture uses the actual generated auth service and DB.
            // No provider success is implied beyond this exact HTTP interception.
            if (test.database === "sqlite")
              await step("wechat-provider-protocol-and-event-chain", async () => {
                await commands.run(
                  "wechat-protocol",
                  root,
                  "bun",
                  [path.join(import.meta.dir, "wechat.ts"), project],
                  { NODE_ENV: "development" },
                );
              });
            report.status = "passed";
          } else report.status = action === "prepare" ? "prepared" : "checked";
        }
      } catch (error) {
        report.status = "failed";
        report.detail = commands.redact(String(error));
        process.exitCode = 1;
      } finally {
        try {
          await commands.stopAll();
          await database?.close();
        } catch (error) {
          report.status = "failed";
          report.results.push({ name: "process-cleanup", status: "failed", detail: String(error) });
          process.exitCode = 1;
        }
        await save();
        reports.push(report);
      }
    }
  } finally {
    await lock.close();
    await rm(path.join(directory, "runner.lock"));
  }
  await writeFile(path.join(directory, "results.json"), JSON.stringify(reports, null, 2), {
    mode: 0o600,
  });
  console.log(JSON.stringify(reports, null, 2));
}

function environment(test: C2Case, databaseUrl: string) {
  const providerEnv: Record<string, string> = {};
  if (test.email === "resend") providerEnv.RESEND_API_KEY = "";
  else {
    providerEnv.SMTP_HOST = "";
    providerEnv.SMTP_USER = "";
    providerEnv.SMTP_PASSWORD = "";
  }
  if (test.sms === "aliyun") {
    providerEnv.ALIYUN_SMS_ACCESS_KEY_ID = "";
    providerEnv.ALIYUN_SMS_ACCESS_KEY_SECRET = "";
  } else if (test.sms === "tencent") {
    providerEnv.TENCENT_SMS_SECRET_ID = "";
    providerEnv.TENCENT_SMS_SECRET_KEY = "";
  } else {
    providerEnv.TWILIO_ACCOUNT_SID = "";
    providerEnv.TWILIO_AUTH_TOKEN = "";
  }
  return {
    NODE_ENV: "development",
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    ADMIN_EMAILS: "admin-c2@example.test",
    EMAIL_FROM: "C2 Fixture <noreply@example.test>",
    SMS_DELIVERY_MODE: "console",
    TURNSTILE_SITE_KEY: "captcha-fixture-site",
    TURNSTILE_SECRET_KEY: "captcha-fixture-secret",
    TURNSTILE_TEST_MODE: "false",
    GOOGLE_CLIENT_ID: "c2-google-fixture",
    GOOGLE_CLIENT_SECRET: "c2-google-not-cloud-secret",
    GITHUB_CLIENT_ID: "c2-github-fixture",
    GITHUB_CLIENT_SECRET: "c2-github-not-cloud-secret",
    WECHAT_CLIENT_ID: "c2-wechat-fixture",
    WECHAT_CLIENT_SECRET: "c2-wechat-not-cloud-secret",
    ...providerEnv,
  };
}
async function assertAbsent(target: string, message: string) {
  try {
    await access(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(message);
}
async function available(port: number) {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
}
async function ready(
  origin: string,
  runtime: { finished: PromiseLike<unknown>; log: string },
  abort: AbortSignal,
  requireOk = true,
) {
  const deadline = Date.now() + 180_000;
  let exited = false;
  void runtime.finished.then(() => {
    exited = true;
  });
  while (Date.now() < deadline) {
    abort.throwIfAborted();
    if (exited) throw new Error(`Server exited before readiness: ${runtime.log}`);
    try {
      const response = await fetch(origin, {
        signal: AbortSignal.any([abort, AbortSignal.timeout(5000)]),
        redirect: "manual",
      });
      await response.arrayBuffer();
      if (!requireOk || response.ok) return;
    } catch {
      abort.throwIfAborted();
    }
    await Bun.sleep(300);
  }
  throw new Error(`Readiness timeout at ${origin}: ${runtime.log}`);
}
async function claimPostgres(caseDirectory: string) {
  const url = process.env.C2_DATABASE_URL;
  assert.ok(
    url && process.env.C2_DISPOSABLE_POSTGRES === "1",
    "Postgres requires C2_DATABASE_URL and C2_DISPOSABLE_POSTGRES=1; use an empty disposable database",
  );
  assert.ok(["postgres:", "postgresql:"].includes(new URL(url).protocol));
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname),
    "Postgres acceptance only permits a disposable loopback database",
  );
  const sql = new SQL(url, { max: 1, connectionTimeout: 15 });
  try {
    const tables = await sql.unsafe(
      "SELECT tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')",
    );
    assert.equal(tables.length, 0, "Refusing a non-empty Postgres database");
  } finally {
    await sql.close();
  }
  await writeFile(
    path.join(caseDirectory, "postgres-owner.json"),
    JSON.stringify({ urlHash: createHash("sha256").update(url).digest("hex") }),
    { mode: 0o600 },
  );
  return url;
}
async function cleanPostgres(url: string, caseDirectory: string) {
  const owner = JSON.parse(
    await readFile(path.join(caseDirectory, "postgres-owner.json"), "utf8"),
  ) as { urlHash: string };
  assert.equal(owner.urlHash, createHash("sha256").update(url).digest("hex"));
  assert.equal(
    process.env.C2_DISPOSABLE_POSTGRES,
    "1",
    "Cleanup requires C2_DISPOSABLE_POSTGRES=1",
  );
  const sql = new SQL(url, { max: 1, connectionTimeout: 15 });
  try {
    const known = new Set([
      "user",
      "session",
      "account",
      "verification",
      "phone_otp_challenge",
      "rate_limit",
      "__drizzle_migrations",
    ]);
    const tables = (await sql.unsafe(
      "SELECT schemaname, tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')",
    )) as { schemaname: string; tablename: string }[];
    for (const table of tables)
      assert.ok(
        known.has(table.tablename) && ["public", "drizzle"].includes(table.schemaname),
        `Unknown table ${table.schemaname}.${table.tablename}; cleanup refuses destructive action`,
      );
    for (const table of tables)
      await sql.unsafe(`DROP TABLE "${table.schemaname}"."${table.tablename}" CASCADE`);
  } finally {
    await sql.close();
  }
  await rm(path.join(caseDirectory, "postgres-owner.json"));
}
