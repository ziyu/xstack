#!/usr/bin/env bun
// Verify xstack installs and runs under npm, pnpm, and bun.
// Catches any regression that breaks the published artifact for consumers —
// unresolved protocol refs, missing files, broken bin entry, import failures
// from missing transitive deps, etc.
//
// Packs each publishable workspace with `npm pack` (matching the release
// workflow, which uses `npm publish`), installs the CLI tarball in a temp
// dir using overrides to redirect sibling workspace deps at their local
// tarballs, then runs `xstack --version` to prove the binary
// actually executes.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { $ } from "bun";

interface PackageFixture {
  name: string;
  private: boolean;
  version: string;
  dependencies: Record<string, string>;
  pnpm?: { overrides: Record<string, string> };
  overrides?: Record<string, string>;
}

const ROOT = resolve(import.meta.dir, "..");

type Publishable = {
  name: string;
  dir: string;
  // Release workflow rewrites workspace:* → ^<version> via jq before publish.
  // Mirror that here so the tarball matches what actually ships.
  rewriteWorkspaceDeps?: string[];
};

const PUBLISHABLES: Publishable[] = [
  { name: "@xstack/types", dir: "packages/types" },
  { name: "@xstack/template-generator", dir: "packages/template-generator" },
  {
    name: "xstack",
    dir: "apps/cli",
    rewriteWorkspaceDeps: ["@xstack/types", "@xstack/template-generator"],
  },
];

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function pack(pkg: Publishable, outDir: string): Promise<string> {
  const pkgJsonPath = join(ROOT, pkg.dir, "package.json");
  const original = readFileSync(pkgJsonPath, "utf-8");

  if (pkg.rewriteWorkspaceDeps) {
    const parsed = JSON.parse(original);
    for (const bucket of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ] as const) {
      const deps = parsed[bucket];
      if (!deps) continue;
      for (const d of pkg.rewriteWorkspaceDeps) {
        if (deps[d]?.startsWith("workspace:")) {
          deps[d] = `^${parsed.version}`;
        }
      }
    }
    writeFileSync(pkgJsonPath, `${JSON.stringify(parsed, null, 2)}\n`);
  }

  try {
    const r = await $`npm pack --pack-destination=${outDir} --json`
      .cwd(join(ROOT, pkg.dir))
      .quiet();
    const [entry] = JSON.parse(r.stdout.toString()) as Array<{ filename: string }>;
    return join(outDir, entry.filename);
  } finally {
    if (pkg.rewriteWorkspaceDeps) writeFileSync(pkgJsonPath, original);
  }
}

async function installAndRun(
  pm: "npm" | "pnpm" | "bun",
  tarballs: Record<string, string>,
  smokeRoot: string,
) {
  const dir = join(smokeRoot, `install-${pm}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const overrides = {
    "@xstack/types": `file:${tarballs["@xstack/types"]}`,
    "@xstack/template-generator": `file:${tarballs["@xstack/template-generator"]}`,
  } satisfies Record<string, string>;
  const fixture: PackageFixture = {
    name: `smoke-${pm}`,
    private: true,
    version: "0.0.0",
    dependencies: { "xstack": `file:${tarballs["xstack"]}` },
  };
  if (pm === "pnpm") fixture.pnpm = { overrides };
  else fixture.overrides = overrides;

  writeFileSync(join(dir, "package.json"), JSON.stringify(fixture, null, 2));

  if (pm === "pnpm") {
    writeFileSync(
      join(dir, ".pnpmfile.cjs"),
      `const localDeps = ${JSON.stringify(overrides, null, 2)};

module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === "xstack") {
        pkg.dependencies = {
          ...pkg.dependencies,
          "@xstack/types": localDeps["@xstack/types"],
          "@xstack/template-generator": localDeps["@xstack/template-generator"],
        };
      }

      if (pkg.name === "@xstack/template-generator") {
        pkg.dependencies = {
          ...pkg.dependencies,
          "@xstack/types": localDeps["@xstack/types"],
        };
      }

      return pkg;
    },
  },
};
`,
    );
  }

  const install = await $`${pm} install --ignore-scripts`.cwd(dir).quiet().nothrow();
  if (install.exitCode !== 0) {
    console.error(red(`✗ ${pm} install failed`));
    const output = `${install.stderr.toString()}${install.stdout.toString()}`.trim();
    console.error(dim(output || "(no install output)"));
    process.exit(1);
  }

  // Execute the CLI via its installed bin path to prove it actually works —
  // not just that the file got linked into node_modules/.bin.
  const bin = join(dir, "node_modules", ".bin", "xstack");
  const run = await $`${bin} --version`.cwd(dir).quiet().nothrow();
  if (run.exitCode !== 0) {
    console.error(red(`✗ ${pm}: xstack --version failed (exit ${run.exitCode})`));
    console.error(dim(run.stderr.toString() + run.stdout.toString()));
    process.exit(1);
  }

  console.log(green(`✓ ${pm}`) + dim(`  v${run.stdout.toString().trim()}`));
}

async function hasPackageManager(pm: string): Promise<boolean> {
  return (await $`which ${pm}`.quiet().nothrow()).exitCode === 0;
}

const smokeRoot = join(tmpdir(), `xstack-publish-smoke-${Date.now()}`);
const tarballDir = join(smokeRoot, "tarballs");
mkdirSync(tarballDir, { recursive: true });

console.log("Packing...");
const tarballs: Record<string, string> = {};
for (const pkg of PUBLISHABLES) {
  tarballs[pkg.name] = await pack(pkg, tarballDir);
  console.log(dim(`  ${pkg.name}`));
}

console.log("\nInstalling and running xstack under each package manager...");
for (const pm of ["npm", "pnpm", "bun"] as const) {
  if (!(await hasPackageManager(pm))) {
    console.log(dim(`  - ${pm} not available, skipping`));
    continue;
  }
  await installAndRun(pm, tarballs, smokeRoot);
}

rmSync(smokeRoot, { recursive: true, force: true });
console.log(green("\n✓ publish smoke test passed"));
