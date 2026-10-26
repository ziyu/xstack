import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { parseArgs } from "node:util";

import { ApplicationSelectionStackSchema } from "@xstack/types";
import { SQL } from "bun";
import { z } from "zod";

import { generate } from "../../../packages/template-generator/src/generator";
import type { VirtualNode } from "../../../packages/template-generator/src/types";
import { Commands } from "./command";
import {
  frameworkCases,
  frameworkCatalog,
  frameworkProjectConfig,
  type FrameworkCase,
} from "./framework-cases";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    case: { type: "string", default: "all" },
    framework: { type: "string" },
    variant: { type: "string" },
    directory: { type: "string" },
    generator: { type: "string", default: "source" },
    resume: { type: "boolean", default: false },
  },
});
const action = positionals[0] ?? "plan";
assert.ok(
  [
    "plan",
    "generate",
    "install",
    "typecheck",
    "build",
    "runtime",
    "run",
    "report",
    "cleanup",
  ].includes(action),
);
assert.ok(["source", "cli"].includes(values.generator!));
const root = path.resolve(import.meta.dir, "../../..");
const smoke = path.join(root, "apps/cli/.smoke");
const directory = path.resolve(values.directory ?? path.join(smoke, "framework-matrix"));
assert.ok(
  directory.startsWith(smoke + path.sep),
  "Matrix root must be strictly inside apps/cli/.smoke",
);
const catalog = await frameworkCatalog(root);
const inventory = frameworkCases(catalog);
const filter = (selection: string | undefined, actual: string) =>
  !selection || selection === "all" || selection.split(",").includes(actual);
const selected = inventory.filter(
  (test) =>
    filter(values.case, test.id) &&
    filter(values.framework, test.framework) &&
    filter(values.variant, test.variant),
);
assert.ok(selected.length, "No matrix cases match filters");
for (const [selection, available] of [
  [values.case, inventory.map((test) => test.id)],
  [values.framework, [...catalog.frameworks.keys()]],
  [values.variant, inventory.map((test) => test.variant)],
] as const) {
  if (selection && selection !== "all")
    for (const name of selection.split(","))
      assert.ok(available.includes(name), `Unknown matrix selector: ${name}`);
}
const abort = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => abort.abort());
const stages = ["generate", "install", "typecheck", "build", "runtime"] as const;
type Stage = (typeof stages)[number];
type Step = {
  stage: Stage | "cleanup";
  status: "passed" | "failed" | "limited";
  detail?: string;
  startedAt: string;
  finishedAt: string;
};
type Report = {
  id: string;
  framework: string;
  type: string;
  variant: string;
  generator: string;
  project: string;
  fingerprint: string;
  steps: Step[];
};
type Ownership = {
  kind: "xstack-framework-matrix";
  case: string;
  project: string;
  fingerprint: string;
  secret: string;
};
const metadataSchema = z
  .array(
    z.object({
      id: z.string(),
      type: z.string(),
      stack: ApplicationSelectionStackSchema,
      roles: z.array(z.string()),
      product: z.string().nullable(),
      bindings: z.record(z.string(), z.string()),
      directory: z.string(),
      port: z.number().int().min(1).max(65535),
      origin: z.string().url(),
      devArgs: z.array(z.string()),
    }),
  )
  .min(1);
type Application = z.infer<typeof metadataSchema>[number];
const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));
const exists = async (file: string) => {
  try {
    await access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};
const save = <T>(file: string, data: T) =>
  writeFile(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });

if (action === "plan") {
  console.log(
    JSON.stringify(
      {
        directory,
        generator: values.generator,
        adapterCount: catalog.frameworks.size,
        implementations: catalog.implementations.map(({ framework, type, manifest }) => ({
          framework,
          type,
          roles: manifest.roles,
          scope: manifest.scope,
        })),
        cases: selected,
        stages,
        commands: {
          generation: "source generator with live templates, or --generator cli for built CLI",
          runtime: "bun run dev followed by applications.json devArgs; no app-ID switches",
        },
        limits: [
          "Runtime jobs share generated ports: run serially; install/typecheck/build may run in separate roots concurrently",
          "No cloud deployment/provisioning commands are executed",
          "Native bundle export is local; device and store validation require hardware/credentials",
          "Clerk authentication requires real external credentials; artifact/type/build checks remain required",
        ],
      },
      null,
      2,
    ),
  );
} else if (action === "report") {
  const reports = [];
  for (const test of selected) {
    const file = path.join(directory, test.id, "result.json");
    reports.push((await exists(file)) ? await json(file) : { id: test.id, status: "not-run" });
  }
  console.log(
    JSON.stringify(
      { adapterCount: catalog.frameworks.size, selectedCases: selected.length, reports },
      null,
      2,
    ),
  );
  if (
    reports.some(
      (report) =>
        report.status === "not-run" || report.steps?.some((step: Step) => step.status === "failed"),
    )
  )
    process.exitCode = 1;
} else {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  assert.ok(
    (await realpath(directory)).startsWith((await realpath(smoke)) + path.sep),
    "Matrix root symlink escape",
  );
  const lockPath = path.join(directory, "runner.lock");
  const lock = await open(lockPath, "wx", 0o600);
  await lock.writeFile(
    JSON.stringify({ pid: process.pid, action, startedAt: new Date().toISOString() }),
  );
  try {
    await save(path.join(directory, "inventory.json"), {
      adapters: [...catalog.frameworks.keys()],
      cases: inventory,
    });
    for (const test of selected) {
      abort.signal.throwIfAborted();
      const caseDirectory = path.join(directory, test.id);
      const project = path.join(caseDirectory, String(test.input.projectName));
      await mkdir(caseDirectory, { recursive: true, mode: 0o700 });
      assert.ok(
        (await realpath(caseDirectory)).startsWith((await realpath(directory)) + path.sep),
        "Case symlink escape",
      );
      const ownershipPath = path.join(caseDirectory, "ownership.json");
      const reportPath = path.join(caseDirectory, "result.json");
      const digest = createHash("sha256")
        .update(JSON.stringify(test.input))
        .update(values.generator!)
        .digest("hex");
      let report: Report = {
        id: test.id,
        framework: test.framework,
        type: test.type,
        variant: test.variant,
        generator: values.generator!,
        project,
        fingerprint: digest,
        steps: [],
      };
      if (await exists(reportPath)) {
        report = await json(reportPath);
        assert.equal(report.fingerprint, digest, "Case definition changed: use a fresh root");
      }
      const logDirectory = path.join(
        caseDirectory,
        `logs-${Date.now()}-${randomBytes(3).toString("hex")}`,
      );
      await mkdir(logDirectory, { mode: 0o700 });
      const commands = new Commands(logDirectory, abort.signal);
      let ownership: Ownership | undefined;
      try {
        if (await exists(ownershipPath)) {
          ownership = await json(ownershipPath);
          assert.equal(ownership!.kind, "xstack-framework-matrix");
          assert.equal(ownership!.case, test.id);
          assert.equal(ownership!.project, project);
          assert.equal(ownership!.fingerprint, digest);
        }
        if (action === "cleanup") {
          assert.ok(ownership, "Refusing to remove a project without its ownership manifest");
          await cleanupPostgres(caseDirectory);
          if (await exists(project)) {
            assert.ok(!(await lstat(project)).isSymbolicLink(), "Refusing symlink cleanup");
            assert.ok(
              (await realpath(project)).startsWith((await realpath(caseDirectory)) + path.sep),
            );
          }
          await rm(project, { recursive: true, force: true });
          await rm(ownershipPath);
          report.steps = [];
          const now = new Date().toISOString();
          report.steps.push({
            stage: "cleanup",
            status: "passed",
            startedAt: now,
            finishedAt: now,
          });
          await save(reportPath, report);
          continue;
        }
        const requested = action === "run" ? stages : [action as Stage];
        for (const stage of requested) {
          if (
            values.resume &&
            report.steps.some((step) => step.stage === stage && step.status === "passed")
          )
            continue;
          const step: Step = {
            stage,
            status: "failed",
            startedAt: new Date().toISOString(),
            finishedAt: "",
          };
          report.steps = report.steps.filter(
            (old) =>
              old.stage !== stage &&
              (old.stage === "cleanup" || stages.indexOf(old.stage) < stages.indexOf(stage)),
          );
          report.steps.push(step);
          try {
            if (stage === "generate") {
              assert.ok(
                !(await exists(project)),
                "Project exists: --resume completed stages or cleanup first; never overwrite",
              );
              ownership = {
                kind: "xstack-framework-matrix",
                case: test.id,
                project,
                fingerprint: digest,
                secret: randomBytes(32).toString("hex"),
              };
              await save(ownershipPath, ownership);
              if (values.generator === "cli") {
                await commands.run("generate-cli", caseDirectory, "node", [
                  path.join(root, "apps/cli/dist/cli.mjs"),
                  "create-json",
                  "--json",
                  JSON.stringify(test.input),
                ]);
              } else {
                const result = await generate({
                  config: frameworkProjectConfig(test, project),
                  templates: catalog.templates,
                  templateBasePath: path.join(root, "packages/template-generator/templates"),
                  trace: true,
                });
                if (result.isErr()) throw result.error;
                await mkdir(project, { mode: 0o700 });
                await materialize(result.value.root, project);
                await save(path.join(caseDirectory, "provenance.json"), result.value.provenance);
              }
              await inspectArtifacts(test, project);
              await writeEnvironment(test, project, ownership.secret);
            } else {
              assert.ok(ownership, "Run generate first");
              assert.ok(
                report.steps.some(
                  (entry) => entry.stage === "generate" && entry.status === "passed",
                ),
                "Generation did not pass",
              );
              const apps = await applications(project);
              commands.secret(ownership.secret);
              const databaseUrl =
                test.input.database === "postgres" && stage === "runtime"
                  ? await claimPostgres(caseDirectory)
                  : test.input.database === "postgres"
                    ? "postgresql://matrix:matrix@127.0.0.1:1/matrix"
                    : `file:${path.join(project, "matrix.sqlite")}`;
              commands.secret(databaseUrl);
              const env = {
                NODE_ENV: stage === "runtime" ? "development" : "production",
                BETTER_AUTH_SECRET: ownership.secret,
                DATABASE_URL: databaseUrl,
              };
              if (stage === "install") {
                const extra = z
                  .array(z.string())
                  .parse(JSON.parse(process.env.FRAMEWORK_INSTALL_ARGS ?? "[]"));
                await commands.run("install", project, "bun", ["install", ...extra], {
                  ...env,
                  NODE_ENV: "development",
                });
                if (test.input.orm === "prisma") {
                  const pkg = await json(path.join(project, "package.json"));
                  assert.ok(pkg.scripts?.["db:generate"], "Prisma case has no db:generate script");
                  await commands.run(
                    "database-client-generate",
                    project,
                    "bun",
                    ["run", "db:generate"],
                    env,
                  );
                }
              } else if (stage === "typecheck" || stage === "build") {
                assert.ok(
                  report.steps.some(
                    (entry) => entry.stage === "install" && entry.status === "passed",
                  ),
                  "Run install first",
                );
                if (await exists(path.join(project, "packages"))) {
                  for (const entry of await readdir(path.join(project, "packages"), {
                    withFileTypes: true,
                  })) {
                    if (!entry.isDirectory()) continue;
                    const cwd = path.join(project, "packages", entry.name);
                    if (!(await exists(path.join(cwd, "package.json")))) continue;
                    const pkg = await json(path.join(cwd, "package.json"));
                    const script =
                      stage === "typecheck"
                        ? ["check-types", "typecheck", "check"].find((name) => pkg.scripts?.[name])
                        : pkg.scripts?.build
                          ? "build"
                          : undefined;
                    if (script)
                      await commands.run(
                        `shared-${entry.name}-${stage}`,
                        cwd,
                        "bun",
                        ["run", script],
                        env,
                      );
                    else if (
                      stage === "typecheck" &&
                      (await exists(path.join(cwd, "tsconfig.json")))
                    )
                      await commands.run(
                        `shared-${entry.name}-typecheck`,
                        cwd,
                        "bun",
                        ["x", "--no-install", "tsc", "--noEmit"],
                        env,
                      );
                  }
                }
                for (const app of apps) {
                  const cwd = path.join(project, app.directory);
                  const pkg = await json(path.join(cwd, "package.json"));
                  const script =
                    stage === "typecheck"
                      ? ["check-types", "typecheck", "check"].find((name) => pkg.scripts?.[name])
                      : pkg.scripts?.build
                        ? "build"
                        : undefined;
                  if (script)
                    await commands.run(`${app.id}-${stage}`, cwd, "bun", ["run", script], env);
                  else if (stage === "build" && pkg.dependencies?.expo)
                    await commands.run(
                      `${app.id}-export`,
                      cwd,
                      "bun",
                      [
                        "x",
                        "--no-install",
                        "expo",
                        "export",
                        "--platform",
                        "all",
                        "--output-dir",
                        ".matrix-export",
                      ],
                      env,
                    );
                  else throw new Error(`${app.id} has no ${stage} command (not a pass)`);
                }
              } else if (stage === "runtime") {
                assert.ok(
                  report.steps.some(
                    (entry) => entry.stage === "install" && entry.status === "passed",
                  ),
                  "Run install first",
                );
                const limitations = await runtime(test, project, apps, commands, env);
                if (limitations.length) {
                  step.status = "limited";
                  step.detail = limitations.join("; ");
                }
              }
            }
            if (step.status !== "limited") step.status = "passed";
          } catch (error) {
            step.detail = commands.redact(
              error instanceof Error ? `${error.name}: ${error.message}` : String(error),
            );
            process.exitCode = 1;
          } finally {
            step.finishedAt = new Date().toISOString();
            await save(reportPath, report);
          }
          console.log(
            `${test.id}: ${stage} ${step.status}${step.detail ? ` — ${step.detail}` : ""}`,
          );
          if (step.status === "failed") break;
        }
      } catch (error) {
        const now = new Date().toISOString();
        report.steps.push({
          stage:
            action === "cleanup" ? "cleanup" : action === "run" ? "generate" : (action as Stage),
          status: "failed",
          detail: commands.redact(String(error)),
          startedAt: now,
          finishedAt: now,
        });
        process.exitCode = 1;
        await save(reportPath, report);
      } finally {
        await commands.stopAll();
      }
    }
  } finally {
    await lock.close();
    await rm(lockPath);
  }
}

async function materialize(node: VirtualNode, project: string) {
  if (node.type === "directory") {
    for (const child of node.children) await materialize(child, project);
    return;
  }
  const destination = path.resolve(project, node.path);
  assert.ok(
    destination.startsWith(project + path.sep),
    `Generated path escapes project: ${node.path}`,
  );
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  if (node.sourcePath) {
    const templates = path.join(root, "packages/template-generator/templates");
    const source = await realpath(path.resolve(templates, node.sourcePath));
    assert.ok(
      source.startsWith((await realpath(templates)) + path.sep),
      "Binary template source escapes template root",
    );
    await copyFile(source, destination);
    await chmod(destination, 0o600);
  } else await writeFile(destination, node.content, { mode: 0o600 });
}

async function applications(project: string) {
  const apps = metadataSchema.parse(await json(path.join(project, "applications.json")));
  const ids = new Set<string>();
  const roots = new Set<string>();
  const ports = new Set<number>();
  for (const app of apps) {
    assert.ok(!ids.has(app.id));
    ids.add(app.id);
    assert.ok(!ports.has(app.port));
    ports.add(app.port);
    assert.ok(!path.isAbsolute(app.directory));
    const directory = await realpath(path.resolve(project, app.directory));
    assert.ok(directory.startsWith((await realpath(project)) + path.sep));
    assert.ok(!roots.has(directory));
    roots.add(directory);
    const origin = new URL(app.origin);
    assert.ok(["localhost", "127.0.0.1"].includes(origin.hostname));
    assert.equal(origin.protocol, "http:");
    assert.equal(Number(origin.port), app.port);
  }
  for (const app of apps)
    for (const [role, id] of Object.entries(app.bindings)) {
      const owner = apps.find((candidate) => candidate.id === id);
      assert.ok(owner, `Missing ${role} binding ${app.id} -> ${id}`);
      assert.ok(owner.roles.includes(role), `Invalid ${role} binding ${app.id} -> ${id}`);
      assert.equal(owner.product, app.product);
    }
  return apps;
}

async function inspectArtifacts(test: FrameworkCase, project: string) {
  const apps = await applications(project);
  assert.deepEqual(apps.map((app) => app.id).sort(), test.input.apps!.map((app) => app.id).sort());
  for (const app of apps) {
    assert.equal(app.directory, `apps/${app.id}`);
    const pkg = await json(path.join(project, app.directory, "package.json"));
    assert.ok(
      pkg.name && (pkg.scripts?.dev || pkg.scripts?.["dev:bare"]),
      `Missing package/development script for ${app.id}`,
    );
    if (!pkg.scripts?.dev) {
      const infrastructure = path.join(project, "packages/infra/package.json");
      assert.ok(
        await exists(infrastructure),
        `${app.id} has only dev:bare without an infrastructure owner`,
      );
      const infra = await json(infrastructure);
      assert.ok(
        infra.scripts?.dev && pkg.devDependencies?.[infra.name],
        `${app.id} does not bind its infrastructure development owner`,
      );
    }
  }
  const workspace = await json(path.join(project, "package.json"));
  assert.ok(workspace.workspaces, "Missing workspace declaration");
  const packageNames = new Set<string>();
  if (await exists(path.join(project, "packages")))
    for (const entry of await readdir(path.join(project, "packages"), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgPath = path.join(project, "packages", entry.name, "package.json");
      if (!(await exists(pkgPath))) continue;
      const pkg = await json(pkgPath);
      assert.ok(!packageNames.has(pkg.name), `Duplicate shared package ${pkg.name}`);
      packageNames.add(pkg.name);
    }
  for (const app of apps.filter((candidate) => candidate.bindings.backend)) {
    const owner = apps.find((candidate) => candidate.id === app.bindings.backend)!;
    const contents = (await textFiles(path.join(project, app.directory)))
      .map((file) => file.text)
      .join("\n");
    assert.ok(
      contents.includes(owner.origin),
      `${app.id} does not declare bound backend origin ${owner.origin}`,
    );
  }
  for (const file of await textFiles(project)) {
    if (file.name.endsWith(".md") || file.name.endsWith(".jsonc")) continue;
    for (const canonical of [
      "web",
      "server",
      "native",
      "cli",
      "admin",
      "backend",
      "fullstack-web",
      "web-frontend",
    ])
      assert.ok(
        !new RegExp(`(?:^|[\\s"'\x60])(?:\\./)?apps/${canonical}(?:/|[\\s"'\x60]|$)`, "m").test(
          file.text,
        ),
        `Canonical application path survived in ${file.name}`,
      );
  }
  for (const [field, role] of [
    ["webDeploy", "web-frontend"],
    ["serverDeploy", "backend"],
  ] as const) {
    const target = test.input[field];
    if (!target || target === "none") continue;
    const owners = apps.filter((app) => app.roles.includes(role));
    assert.ok(owners.length, `No ${role} deployment owner`);
    const files = await textFiles(project);
    const pattern =
      target === "docker"
        ? /Dockerfile|docker-compose/
        : target === "vercel"
          ? /vercel(?:\.[a-z0-9-]+)?\.json$/
          : /alchemy\.run|wrangler\./;
    const evidence = files.filter((file) => pattern.test(file.name));
    assert.ok(evidence.length, `No generated deployment artifacts for ${target}`);
    for (const owner of owners)
      assert.ok(
        evidence.some(
          (file) =>
            file.name.startsWith(`${owner.directory}/`) ||
            file.text.includes(owner.directory) ||
            file.text.includes(owner.id),
        ),
        `Deployment ${target} does not target ${owner.id}`,
      );
  }
}

async function textFiles(
  directory: string,
  prefix = "",
): Promise<{ name: string; text: string }[]> {
  const files: { name: string; text: string }[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      ["node_modules", ".git", ".next", ".nuxt", ".output", "dist", ".matrix-export"].includes(
        entry.name,
      )
    )
      continue;
    const full = path.join(directory, entry.name);
    const name = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await textFiles(full, name)));
    else if (
      entry.isFile() &&
      !/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|pdf|sqlite)$/.test(name)
    )
      files.push({ name, text: await readFile(full, "utf8") });
  }
  return files;
}

async function writeEnvironment(test: FrameworkCase, project: string, secret: string) {
  const apps = await applications(project);
  for (const app of apps) {
    const backend = app.roles.includes("backend")
      ? app
      : apps.find((candidate) => candidate.id === app.bindings.backend);
    const environment: Record<string, string> = {};
    const schemaFile = path.join(project, app.directory, ".env.schema");
    const schema = (await exists(schemaFile)) ? await readFile(schemaFile, "utf8") : "";
    const declared = new Set(
      [...schema.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)=/gm)].map((match) => match[1]),
    );
    if (app.roles.includes("backend")) {
      environment.BETTER_AUTH_SECRET = secret;
      environment.BETTER_AUTH_URL = app.origin;
      environment.DATABASE_URL =
        test.input.database === "postgres"
          ? "postgresql://matrix:matrix@127.0.0.1:1/matrix"
          : `file:${path.join(project, "matrix.sqlite")}`;
      environment.CORS_ORIGIN =
        apps.find((client) => client.bindings.backend === app.id)?.origin ?? app.origin;
    } else if (backend) {
      for (const key of [
        "VITE_SERVER_URL",
        "NEXT_PUBLIC_SERVER_URL",
        "NUXT_PUBLIC_SERVER_URL",
        "PUBLIC_SERVER_URL",
        "EXPO_PUBLIC_SERVER_URL",
      ])
        environment[key] = backend.origin;
    }
    // Preserve generated framework-specific env declarations and replace only known local values.
    const file = path.join(project, app.directory, ".env");
    let contents = (await exists(file)) ? await readFile(file, "utf8") : "";
    for (const [key, value] of Object.entries(environment)) {
      if (!declared.has(key)) continue;
      const line = `${key}=${JSON.stringify(value)}`;
      const matcher = new RegExp(`^${key}=.*$`, "m");
      contents = matcher.test(contents)
        ? contents.replace(matcher, line)
        : `${contents}\n${line}\n`;
    }
    await writeFile(file, contents, { mode: 0o600 });
  }
  if (await exists(path.join(project, "packages/db")))
    await writeFile(
      path.join(project, "packages/db/.env"),
      `DATABASE_URL=${JSON.stringify(test.input.database === "postgres" ? "postgresql://matrix:matrix@127.0.0.1:1/matrix" : `file:${path.join(project, "matrix.sqlite")}`)}\n`,
      { mode: 0o600 },
    );
}

async function runtime(
  test: FrameworkCase,
  project: string,
  apps: Application[],
  commands: Commands,
  env: NodeJS.ProcessEnv,
) {
  const limitations: string[] = [];
  if (
    test.auth === "clerk" &&
    !(
      process.env.CLERK_SECRET_KEY &&
      (process.env.CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
    )
  )
    limitations.push(
      "Clerk runtime requires real provider credentials; no fake keys or claimed login pass",
    );
  if (limitations.length) return limitations;
  if (test.input.database !== "none") {
    const pkg = await json(path.join(project, "package.json"));
    assert.ok(pkg.scripts?.["db:push"], "Database case has no db:push script");
    await commands.run("database-push", project, "bun", ["run", "db:push"], env);
  }
  // A global lock serializes only HTTP/runtime work, while installs/builds remain independently parallelizable.
  const lockPath = path.join(smoke, "framework-runtime.lock");
  const lock = await open(lockPath, "wx", 0o600);
  await lock.writeFile(String(process.pid));
  try {
    for (const app of [...apps].sort(
      (a, b) => Number(b.roles.includes("backend")) - Number(a.roles.includes("backend")),
    )) {
      const cwd = path.join(project, app.directory);
      const pkg = await json(path.join(cwd, "package.json"));
      if (pkg.dependencies?.expo) {
        limitations.push(
          `${app.id}: exported bundle is not a physical-device or store runtime test`,
        );
        continue;
      }
      if (!pkg.scripts?.dev && pkg.scripts?.["dev:bare"]) {
        limitations.push(
          `${app.id}: development is owned by generated infrastructure; applications.json does not supply a local dev command, so no cloud provisioning or guessed startup was attempted`,
        );
        continue;
      }
      if (/\balchemy\b|\bdeploy\b|\bwrangler\s+(?:deploy|publish)\b/.test(pkg.scripts?.dev ?? "")) {
        limitations.push(
          `${app.id}: metadata dev command may provision infrastructure; local generated deployment artifacts were checked, cloud execution intentionally not attempted`,
        );
        continue;
      }
      if (pkg.bin && !app.roles.length) {
        const output = await commands.run(
          `${app.id}-cli-help`,
          cwd,
          "bun",
          ["run", "dev", "--help"],
          env,
        );
        assert.ok(output.trim(), `CLI ${app.id} returned empty help`);
        continue;
      }
      await available(app.port);
      const appEnvironment = { ...env };
      if (!app.roles.includes("backend")) {
        delete appEnvironment.DATABASE_URL;
        delete appEnvironment.BETTER_AUTH_SECRET;
      }
      const child = commands.start(`${app.id}-dev`, cwd, "bun", ["run", "dev", ...app.devArgs], {
        ...appEnvironment,
        HOST: "127.0.0.1",
        HOSTNAME: "127.0.0.1",
        NITRO_HOST: "127.0.0.1",
        PORT: String(app.port),
        NITRO_PORT: String(app.port),
      });
      const url = app.origin;
      let response: Response | undefined;
      let exited = false;
      void child.finished.then(() => {
        exited = true;
      });
      for (let attempt = 0; attempt < 180; attempt++) {
        abort.signal.throwIfAborted();
        if (exited) throw new Error(`${app.id} exited before readiness: ${child.log}`);
        try {
          const result = await fetch(url, { signal: AbortSignal.timeout(2_000) });
          if (result.status < 500) {
            response = result;
            break;
          }
        } catch {
          /* bounded readiness retry */
        }
        await Bun.sleep(1_000);
      }
      assert.ok(response, `${app.id} did not become ready at metadata origin ${url}; ${child.log}`);
      assert.ok(response.status < 400, `${app.id} root HTTP status ${response.status}`);
      const body = await response.text();
      assert.ok(body.length, `${app.id} returned an empty body`);
      if (app.roles.some((role) => role === "web-frontend" || role === "admin"))
        assert.match(body, /<html|<!doctype/i, `${app.id} did not serve HTML`);
      if (app.roles.includes("backend") && app.stack.api && app.stack.api !== "none") {
        const declaration = catalog.frameworks.get(app.stack.framework!)?.apps[app.type];
        assert.ok(
          declaration?.serverContributions,
          `Missing server protocol declaration for ${app.id}`,
        );
        const prefix = declaration.serverContributions.apiPrefix;
        const endpoint = `${app.origin}${prefix}/${app.stack.api === "trpc" ? "trpc" : "rpc"}/healthCheck`;
        const health = await fetch(
          endpoint,
          app.stack.api === "trpc"
            ? { signal: AbortSignal.timeout(10_000) }
            : {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ json: null }),
                signal: AbortSignal.timeout(10_000),
              },
        );
        assert.equal(health.status, 200, `${app.id} ${app.stack.api} healthCheck`);
        assert.match(
          await health.text(),
          /OK/,
          `${app.id} protocol did not return its declared health value`,
        );
      }
      if (app.roles.includes("backend") && test.auth === "better-auth") {
        const session = await fetch(`${app.origin}/api/auth/get-session`, {
          signal: AbortSignal.timeout(10_000),
        });
        assert.equal(session.status, 200, `${app.id} auth session endpoint`);
        z.object({
          user: z.object({
            id: z.string(),
            email: z.string(),
            name: z.string(),
            emailVerified: z.boolean(),
          }),
          session: z.object({ id: z.string(), userId: z.string(), expiresAt: z.string() }),
        })
          .nullable()
          .parse(await session.json());
      }
    }
    return limitations;
  } finally {
    await commands.stopAll();
    await lock.close();
    await rm(lockPath);
  }
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

async function claimPostgres(caseDirectory: string) {
  const connection = process.env.FRAMEWORK_DATABASE_URL;
  assert.ok(
    connection && process.env.FRAMEWORK_DISPOSABLE_POSTGRES === "1",
    "Postgres runtime requires FRAMEWORK_DATABASE_URL and FRAMEWORK_DISPOSABLE_POSTGRES=1; no unprovisioned database is a pass",
  );
  const url = new URL(connection);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
    "Only disposable loopback Postgres is permitted",
  );
  const marker = path.join(caseDirectory, "postgres-owner.json");
  const hash = createHash("sha256").update(connection).digest("hex");
  let schema: string;
  if (await exists(marker)) {
    const owner = await json(marker);
    assert.equal(owner.urlHash, hash, "Postgres ownership URL changed");
    schema = owner.schema;
    assert.match(schema, /^matrix_[a-f0-9]{24}$/);
  } else {
    schema = `matrix_${randomBytes(12).toString("hex")}`;
    const sql = new SQL(connection, { max: 1, connectionTimeout: 15 });
    try {
      // Persist ownership before creation so an interrupted attempt remains cleanable.
      await save(marker, { urlHash: hash, schema });
      await sql.unsafe(`CREATE SCHEMA "${schema}"`);
    } finally {
      await sql.close();
    }
  }
  url.searchParams.set("options", `-c search_path=${schema}`);
  url.searchParams.set("schema", schema);
  return url.href;
}

async function cleanupPostgres(caseDirectory: string) {
  const marker = path.join(caseDirectory, "postgres-owner.json");
  if (!(await exists(marker))) return;
  const connection = process.env.FRAMEWORK_DATABASE_URL;
  assert.ok(
    connection && process.env.FRAMEWORK_DISPOSABLE_POSTGRES === "1",
    "Postgres cleanup requires the original disposable loopback URL and opt-in",
  );
  const owner = await json(marker);
  assert.equal(owner.urlHash, createHash("sha256").update(connection).digest("hex"));
  assert.match(owner.schema, /^matrix_[a-f0-9]{24}$/);
  const sql = new SQL(connection, { max: 1, connectionTimeout: 15 });
  try {
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${owner.schema}" CASCADE`);
  } finally {
    await sql.close();
  }
  await rm(marker);
}
