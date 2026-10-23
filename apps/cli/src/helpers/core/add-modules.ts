import { isDeepStrictEqual } from "node:util";

import { generateReproducibleCommand } from "@xstack/template-generator";
import {
  XStackConfigSchema,
  type AddInput,
  type ProductConfig,
  type ProjectConfig,
} from "@xstack/types";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import z from "zod";

import { formatCode } from "../../utils/file-formatter";
import { getLatestCLIVersion } from "../../utils/get-latest-cli-version";
import { detectProjectConfig } from "./detect-project-config";
import {
  applyModuleChanges,
  assertSafePath,
  BASELINE_PATH,
  baselineConfig,
  createBaseline,
  isSecretPath,
  loadBaseline,
  ModuleAddError,
  moduleResult,
  readProjectFile,
  regenerate,
  withModuleLock,
  type FileChange,
} from "./module-baseline";
import { mergeGeneratedFile } from "./module-merge";
import { validateProductPlan } from "./product-mode";

export interface ModuleFileStatus {
  path: string;
  status: "added" | "modified" | "deleted" | "conflict";
}
export interface ModuleConflict {
  path: string;
  reason: string;
  resolution: string;
}
export interface ModuleAddOutcome {
  addedFeatures: string[];
  files: ModuleFileStatus[];
  conflicts: ModuleConflict[];
  dryRun: boolean;
  initializedBaseline: boolean;
}

function mergeProduct(
  existing: ProductConfig | undefined,
  requested: ProductConfig,
): ProductConfig {
  const options = { ...existing?.options };
  for (const [name, values] of Object.entries(requested.options ?? {}))
    options[name] = { ...options[name], ...values };
  return {
    features: [...new Set([...(existing?.features ?? []), ...requested.features])],
    providers: { ...existing?.providers, ...requested.providers },
    options,
  };
}

function updateJsonc(
  content: string,
  updates: { product: ProductConfig; reproducibleCommand: string },
): string {
  for (const [key, value] of Object.entries(updates))
    content = applyEdits(
      content,
      modify(content, [key], value, { formattingOptions: { tabSize: 2, insertSpaces: true } }),
    );
  return content;
}

/** Append only missing declarations; never replace an existing credential or value. */
function appendEnvironment(local: string | undefined, generated: string): string {
  const declaration = /^\s*(?:#\s*)?(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
  const keys = new Set(
    (local ?? "").split(/\r?\n/).flatMap((line) => declaration.exec(line)?.[1] ?? []),
  );
  const additions: string[] = [];
  let comments: string[] = [];
  for (const line of generated.split(/\r?\n/)) {
    const key = declaration.exec(line)?.[1];
    if (key) {
      if (!keys.has(key)) {
        additions.push(...comments, line);
        keys.add(key);
      }
      comments = [];
    } else if (!line.trim() || line.trimStart().startsWith("#")) comments.push(line);
    else comments = [];
  }
  if (!additions.length) return local ?? "";
  return `${local ?? ""}${local && !local.endsWith("\n") ? "\n" : ""}${additions.join("\n")}\n`;
}

export function addFeatureModules(projectDir: string, input: AddInput) {
  return moduleResult(() =>
    withModuleLock(projectDir, input.dryRun ?? false, async (): Promise<ModuleAddOutcome> => {
      if (!input.product) throw new ModuleAddError({ message: "A product selection is required." });
      if (
        input.addons?.length ||
        input.package ||
        input.addonOptions ||
        input.webDeploy ||
        input.serverDeploy
      )
        throw new ModuleAddError({
          message:
            "Run feature additions separately from addons, packages, and deployment changes.",
        });
      for (const filePath of ["xstack.jsonc", "package.json", "packages/config/package.json"])
        await assertSafePath(projectDir, filePath);
      const detected = await detectProjectConfig(projectDir);
      if (!detected)
        throw new ModuleAddError({ message: "No valid xstack.jsonc found in the project." });
      if (input.packageManager && input.packageManager !== detected.packageManager)
        throw new ModuleAddError({
          message:
            "Changing package manager during module addition is unsupported; omit --package-manager or use the existing manager.",
        });
      const config: ProjectConfig = { ...detected, relativePath: ".", git: false, install: false };
      const product = mergeProduct(config.product, input.product);
      // Preserve optional representation on repeated additions for a true no-op.
      if (isDeepStrictEqual(product.providers, {})) delete product.providers;
      if (isDeepStrictEqual(product.options, {})) delete product.options;
      const nextConfig = { ...config, product };
      const validation = validateProductPlan(nextConfig);
      if (validation.isErr()) throw new ModuleAddError({ message: validation.error.message });
      const metadataBytes = await readProjectFile(projectDir, "xstack.jsonc");
      if (!metadataBytes) throw new ModuleAddError({ message: "Missing xstack.jsonc" });
      const metadataText = metadataBytes.toString("utf8");
      const parseErrors: ParseError[] = [];
      const metadata = XStackConfigSchema.parse(
        parse(metadataText, parseErrors, { allowTrailingComma: true }),
      );
      if (parseErrors.length)
        throw new ModuleAddError({ message: "Invalid JSONC in xstack.jsonc" });
      const version = getLatestCLIVersion();
      const existingBaselineBytes = await readProjectFile(projectDir, BASELINE_PATH);
      let baseline = await loadBaseline(projectDir);
      let initializedBaseline = false;
      if (!baseline) {
        if (!input.initializeBaseline)
          throw new ModuleAddError({
            message:
              "This project has no trustworthy merge baseline. Run add --features none --initialize-baseline --dry-run, then without --dry-run. Adoption only accepts files matching this generator; preserve custom edits separately and restore the original clean scaffold before adoption.",
          });
        const reproduced = await regenerate(config, version);
        const localPackage = await readProjectFile(projectDir, "package.json");
        if (localPackage && reproduced.has("package.json")) {
          const local = z
            .object({ packageManager: z.string().optional() })
            .parse(JSON.parse(localPackage.toString("utf8")));
          if (local.packageManager) {
            const pkg = z
              .record(z.string(), z.json())
              .parse(JSON.parse(reproduced.get("package.json")!.toString("utf8")));
            pkg.packageManager = local.packageManager;
            reproduced.set("package.json", Buffer.from(`${JSON.stringify(pkg, null, 2)}\n`));
          }
        }
        baseline = createBaseline(config, version, reproduced);
        const mismatches: string[] = [];
        for (const [filePath, stored] of Object.entries(baseline.files)) {
          const local = await readProjectFile(projectDir, filePath);
          const expected = Buffer.from(stored.content, stored.encoding);
          let matches = local?.equals(expected) ?? false;
          if (!matches && local && filePath.endsWith(".json")) {
            try {
              matches = isDeepStrictEqual(
                JSON.parse(local.toString("utf8")),
                JSON.parse(expected.toString("utf8")),
              );
            } catch {
              /* Non-JSON files require exact bytes. */
            }
          }
          if (!matches) mismatches.push(filePath);
        }
        if (mismatches.length)
          throw new ModuleAddError({
            message: `Cannot adopt modified or missing generated files: ${mismatches.join(", ")}. No files changed. Save your customizations separately, restore these files from a clean scaffold matching your config and generator version, adopt, then reapply your edits.`,
          });
        initializedBaseline = true;
      } else if (
        !isDeepStrictEqual(baseline.config, JSON.parse(JSON.stringify(baselineConfig(config))))
      ) {
        throw new ModuleAddError({
          message:
            "xstack.jsonc differs from the recorded baseline configuration (for example after addon/deployment changes). Restore the matching configuration and add modules first, or create a clean scaffold for the current configuration and transfer customizations after adopting its baseline. The old baseline cannot safely be reinterpreted.",
        });
      }
      const next = await regenerate(nextConfig, version);
      // Package manager pins are creation-time metadata, not module-owned changes.
      const basePackage = baseline.files["package.json"];
      if (basePackage && next.has("package.json")) {
        const base = z
          .object({ packageManager: z.string().optional() })
          .parse(JSON.parse(basePackage.content));
        if (base.packageManager) {
          const pkg = z
            .record(z.string(), z.json())
            .parse(JSON.parse(next.get("package.json")!.toString("utf8")));
          pkg.packageManager = base.packageManager;
          const text = `${JSON.stringify(pkg, null, 2)}\n`;
          next.set("package.json", Buffer.from((await formatCode("package.json", text)) ?? text));
        }
      }
      const nextBaseline = createBaseline(nextConfig, version, next);
      const files: ModuleFileStatus[] = [];
      const conflicts: ModuleConflict[] = [];
      const changes: FileChange[] = [];
      for (const filePath of [
        ...new Set([...Object.keys(baseline.files), ...next.keys()]),
      ].sort()) {
        if (filePath === "xstack.jsonc") continue;
        const before = await readProjectFile(projectDir, filePath);
        const generated = next.get(filePath);
        let after: Buffer | undefined;
        if (isSecretPath(filePath)) {
          if (!generated) continue;
          after = Buffer.from(
            appendEnvironment(before?.toString("utf8"), generated.toString("utf8")),
          );
        } else {
          const stored = baseline.files[filePath];
          const base = stored ? Buffer.from(stored.content, stored.encoding) : undefined;
          if (isDeepStrictEqual(before, base)) after = generated;
          else if (isDeepStrictEqual(generated, base) || isDeepStrictEqual(before, generated))
            after = before;
          else {
            const binary = [base, before, generated].some(
              (bytes) =>
                bytes && (bytes.includes(0) || !Buffer.from(bytes.toString("utf8")).equals(bytes)),
            );
            const merged = binary
              ? { clean: false as const }
              : mergeGeneratedFile(
                  base?.toString("utf8"),
                  before?.toString("utf8"),
                  generated?.toString("utf8"),
                  filePath,
                );
            if (!merged.clean) {
              files.push({ path: filePath, status: "conflict" });
              conflicts.push({
                path: filePath,
                reason:
                  "Both your project and generated modules changed overlapping content, or a changed file was deleted.",
                resolution:
                  "Save your customization, restore the affected generated portion to its baseline content (available in .xstack/baseline/manifest.json), rerun, then reapply the customization. No project/config/baseline files were changed.",
              });
              continue;
            }
            after = merged.content === undefined ? undefined : Buffer.from(merged.content);
          }
        }
        if (isDeepStrictEqual(before, after)) continue;
        changes.push({ path: filePath, before, after });
        files.push({
          path: filePath,
          status: before === undefined ? "added" : after === undefined ? "deleted" : "modified",
        });
      }
      const outcome: ModuleAddOutcome = {
        addedFeatures: product.features.filter(
          (feature) => !config.product?.features.includes(feature),
        ),
        files,
        conflicts,
        dryRun: input.dryRun ?? false,
        initializedBaseline,
      };
      if (conflicts.length) return outcome;
      const metadataUpdated = updateJsonc(metadataText, {
        product,
        reproducibleCommand: generateReproducibleCommand(nextConfig),
      });
      // Don't change timestamps or rewrite equivalent metadata on a repeated addition.
      if (
        !isDeepStrictEqual(metadata.product, product) ||
        metadata.reproducibleCommand !== generateReproducibleCommand(nextConfig)
      ) {
        changes.push({
          path: "xstack.jsonc",
          before: metadataBytes,
          after: Buffer.from(metadataUpdated),
        });
        files.push({ path: "xstack.jsonc", status: "modified" });
      }
      const nextBaselineBytes = Buffer.from(`${JSON.stringify(nextBaseline, null, 2)}\n`);
      if (!existingBaselineBytes?.equals(nextBaselineBytes)) {
        changes.push({
          path: BASELINE_PATH,
          before: existingBaselineBytes,
          after: nextBaselineBytes,
        });
        files.push({ path: BASELINE_PATH, status: existingBaselineBytes ? "modified" : "added" });
      }
      if (!input.dryRun) await applyModuleChanges(projectDir, changes);
      return outcome;
    }),
  );
}
