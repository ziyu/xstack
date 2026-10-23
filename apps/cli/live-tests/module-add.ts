import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, lstat } from "node:fs/promises";
import { resolve, sep, join } from "node:path";

import { create, add } from "../src";

// Disposable real CLI API fixture. No provider calls, no production projects.
const project = resolve(process.argv[2] ?? "");
if (!project.startsWith(resolve(import.meta.dir, "../.smoke") + sep))
  throw new Error("Expected a new disposable .smoke project");
const created = await create(project, {
  git: false,
  install: false,
  packageManager: "bun",
  disableAnalytics: true,
  product: { features: ["auth"], providers: { auth: [] } },
});
if (created.isErr()) throw created.error;
async function snapshot(directory: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (["node_modules", ".git", ".next"].includes(entry.name)) continue;
      const file = join(path, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile())
        files[file.slice(directory.length + 1)] = createHash("sha256")
          .update(await readFile(file))
          .digest("hex");
    }
  }
  await visit(directory);
  return files;
}
const home = join(project, "apps/web/src/app/[lang]/page.tsx");
const originalHome = await readFile(home, "utf8");
const customization = "\n// Project-owner customization must survive module addition.\n";
await writeFile(home, originalHome + customization);
const guidancePath = join(project, "AGENTS.md");
const guidance = await readFile(guidancePath, "utf8");
const ownerRule = "\nProject rule: all exports require a reviewed migration.\n";
await writeFile(guidancePath, guidance + ownerRule);
const envPath = join(project, "apps/web/.env");
const envBefore = await readFile(envPath, "utf8");
await writeFile(envPath, envBefore + "\nCUSTOM_LOCAL_SECRET=do-not-copy-into-baseline\n");
const beforeDryRun = await snapshot(project);
const dryRun = await add({
  projectDir: project,
  product: { features: ["credits"], options: { credits: { signupBonus: 17 } } },
  dryRun: true,
  install: false,
  disableAnalytics: true,
});
assert.equal(dryRun.success, true, dryRun.error ?? "Module dry-run failed");
assert.deepEqual(await snapshot(project), beforeDryRun, "Dry-run must not write files or baseline");
const added = await add({
  projectDir: project,
  product: { features: ["credits"], options: { credits: { signupBonus: 17 } } },
  install: false,
  disableAnalytics: true,
});
assert.equal(added.success, true, added.error ?? "Module addition failed");
assert.equal(await readFile(home, "utf8"), originalHome + customization);
assert.equal(
  await readFile(envPath, "utf8"),
  envBefore + "\nCUSTOM_LOCAL_SECRET=do-not-copy-into-baseline\n",
);
const afterFirst = await snapshot(project);
const repeat = await add({
  projectDir: project,
  product: { features: ["credits"] },
  install: false,
  disableAnalytics: true,
});
assert.equal(repeat.success, true, repeat.error ?? "Repeated module addition failed");
assert.deepEqual(await snapshot(project), afterFirst, "Repeated addition must be a no-op");
const payment = await add({
  projectDir: project,
  product: { features: ["payment"], providers: { payment: ["stripe"] } },
  install: false,
  disableAnalytics: true,
});
assert.equal(payment.success, true, payment.error ?? "Payment addition failed");
assert.ok((await readFile(home, "utf8")).includes(customization.trim()));
assert.ok(
  (await readFile(guidancePath, "utf8")).includes(ownerRule.trim()),
  "Module addition overwrote owner guidance",
);
assert.ok((await lstat(join(project, ".agents/skills/xstack-project/SKILL.md"))).isFile());
assert.ok(
  (await readFile(envPath, "utf8")).includes("CUSTOM_LOCAL_SECRET=do-not-copy-into-baseline"),
);
const baselinePath = join(project, ".xstack/baseline");
const baseline = await snapshot(baselinePath);
for (const file of Object.keys(baseline)) {
  const content = await readFile(join(baselinePath, file), "utf8");
  assert.ok(!content.includes("do-not-copy-into-baseline"), "Baseline leaked local env secret");
}
// Generated auth and schema must still be real code: caller installs/typechecks/builds this fixture.
assert.ok((await lstat(join(project, "packages/payment/src/index.ts"))).isFile());
assert.ok((await lstat(join(project, "packages/credits/src/index.ts"))).isFile());
console.log(
  "PASS module add API: fresh baseline, dry-run isolation, preserved user edits/secrets, idempotent replay, sequential credits/payment integration. Install/typecheck/build this fixture next.",
);
