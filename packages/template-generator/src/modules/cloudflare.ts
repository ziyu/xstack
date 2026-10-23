import type { ProjectConfig } from "@xstack/types";

import type { VirtualFileSystem } from "../core/virtual-fs";
import { addPackageDependency, dependencyVersionMap } from "../utils/add-deps";
import type { ResolvedPlan } from "./types";

/** Only platform wiring lives here; feature services remain deployment-independent. */
export function finalizeCloudflareModules(
  vfs: VirtualFileSystem,
  config: ProjectConfig,
  plan: ResolvedPlan,
) {
  if (
    config.webDeploy !== "cloudflare" ||
    config.backend !== "self" ||
    !config.frontend.includes("next")
  )
    return;
  const storage = plan.modules.find((module) => module.manifest.id === "storage");
  const wrangler = vfs.readJson<{ r2_buckets?: { binding: string; bucket_name: string }[] }>(
    "apps/web/wrangler.jsonc",
  );
  if (wrangler && storage?.providers.includes("r2-binding")) {
    wrangler.r2_buckets = [
      { binding: "STORAGE_BUCKET", bucket_name: `${config.projectName}-storage-local` },
    ];
    vfs.writeJson("apps/web/wrangler.jsonc", wrangler);
  }
  const env = vfs.readFile("apps/web/.env") ?? "";
  vfs.writeFile("apps/web/.dev.vars", env);
  const ignore = vfs.readFile("apps/web/.gitignore") ?? "";
  vfs.writeFile("apps/web/.gitignore", `${ignore}\n.dev.vars*\n.wrangler/\n.open-next/\n`);
  const specs = plan.modules.flatMap((module) => [
    ...(module.manifest.env ?? []),
    ...module.providers.flatMap(
      (provider) => module.manifest.providers?.options[provider]?.env ?? [],
    ),
  ]);
  addPackageDependency({
    vfs,
    packagePath: "apps/web/package.json",
    customDependencies: { zod: dependencyVersionMap.zod },
  });
  const uniqueSpecs = new Map(specs.map((spec) => [spec.key, spec]));
  const cases = [...uniqueSpecs.values()].map((spec) => {
    let schema =
      spec.type === "number"
        ? "z.coerce.number().finite()"
        : spec.type === "boolean"
          ? 'z.union([z.boolean(), z.enum(["true", "false"])]).transform((value) => value === true || value === "true")'
          : spec.type === "enum"
            ? `z.enum(${JSON.stringify(spec.values ?? [])})`
            : spec.type === "url"
              ? 'z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol))'
              : spec.type === "secret"
                ? "z.string().min(32)"
                : "z.string().min(1)";
    if (spec.default !== undefined)
      schema += `.default(${spec.type === "number" || spec.type === "boolean" ? spec.default : JSON.stringify(spec.default)})`;
    else if (spec.required === false) schema += ".optional()";
    return `    case ${JSON.stringify(spec.key)}: return ${schema}.parse(value === "" ? undefined : value);`;
  });
  vfs.writeFile(
    "apps/web/src/module-env.ts",
    `import { z } from "zod";\n\n/** Validates module bindings against the generated manifest contract without importing Varlock into Workers. */\nexport function normalizeModuleEnv(key: string, value: unknown): unknown {\n  switch (key) {\n${cases.join("\n")}\n    default: return value;\n  }\n}\n`,
  );
  const serverEnv = vfs.readFile("apps/web/src/env.server.ts");
  if (serverEnv)
    vfs.writeFile(
      "apps/web/src/env.server.ts",
      `import { normalizeModuleEnv } from "./module-env";\n${serverEnv.replace("return getValue(prop as keyof AppEnv & string);", "return normalizeModuleEnv(prop, getValue(prop as keyof AppEnv & string));")}`,
    );
  const run = `${config.packageManager} run`;
  vfs.writeFile(
    "docs/cloudflare.md",
    [
      "# Cloudflare Workers deployment",
      "",
      "Next.js uses OpenNext's Node compatibility runtime (not Next Edge). Native services resolve bindings at request time. D1 uses the Drizzle D1 driver; interactive transactions are unavailable. Credits use D1 atomic batches, not transaction emulation. R2 binding downloads stream through the authenticated owner-only app route, never a public bucket or bearer URL.",
      "",
      "## Local development (no Cloudflare account required)",
      "",
      "1. Install dependencies and configure `apps/web/.env`. Set `BETTER_AUTH_URL=http://localhost:3001`. For SMS-only local checks choose `SMS_DELIVERY_MODE=console`; real email/AI/payment providers require their own credentials and may charge money.",
      `2. Run \`${run} db:generate\` then \`${run} db:migrate:local\`. Generated schemas use SQLite; migrations are generated from the selected module combination. Never use db:push against a local D1 binding.`,
      `3. Run \`cd apps/web && ${run} dev:bare\`. OpenNext initializes local Wrangler D1/R2 bindings; local data persists in \`apps/web/.wrangler/state\`.`,
      `4. To exercise workerd rather than Next dev: copy your current \`apps/web/.env\` to \`apps/web/.dev.vars\`, then run \`cd apps/web && ${run} build:cloudflare && ${run} preview:cloudflare\`. Set BETTER_AUTH_URL to the preview origin (usually http://localhost:8787) before preview. Keep both files uncommitted.`,
      "",
      "The committed wrangler.jsonc describes **local** resources. Do not run wrangler deploy with its local D1 ID; production provisioning and migrations are owned by Alchemy.",
      "",
      "## Production checklist",
      "",
      "- Configure an Alchemy Cloudflare profile with Workers, D1, R2 and account permissions. Choose a production stage, not the default personal development stage.",
      "- Set a unique BETTER_AUTH_SECRET and ALCHEMY_PASSWORD in your deployment environment; fill all selected provider variables from apps/web/.env.schema. Module credentials are forwarded as secret bindings. Public keys remain public.",
      "- Run install, env:generate, check-types, db:generate and build:cloudflare in CI. Review generated SQL before deployment. Alchemy applies D1 migrations during deployment; back up production before destructive changes.",
      "- Deploy with the root deploy command (or `alchemy deploy --stage production` from packages/infra). Alchemy creates the D1 database and a private R2 bucket; disable r2.dev/public domains. Never replace these bindings with public URLs.",
      "- Configure custom domains and exact OAuth redirect URLs, payment webhook URLs/signing secrets, Turnstile domains, verified email sender domains and production AI budgets. BETTER_AUTH_URL is the deployed Worker URL; for a custom domain configure the matching URL in the Alchemy binding.",
      "- Verify signup/session, cross-user storage rejection, streamed attachment bytes and deletion; verify payment replay/idempotency, credits debits/refunds, affiliate grants, captcha rejection, blog permissions and all enabled AI modalities on a disposable staging account.",
      "- OSS, COS, S3/R2 S3 SDK adapters, Alipay, SMTP and Alibaba/Tencent SMS are rejected on Workers; select r2-binding, Stripe/Polar, Resend and Twilio. No selected feature is silently omitted.",
      "",
      "## CI example",
      "",
      "Use your CI secret manager to provide Cloudflare credentials and the module variables. The generated workflow is manually dispatched so commits cannot accidentally deploy or spend credits. Set the deployment stage and credentials before dispatching it.",
      "",
    ].join("\n"),
  );
  vfs.writeFile(
    ".github/workflows/cloudflare.yml",
    `name: Cloudflare production\non:\n  workflow_dispatch:\npermissions:\n  contents: read\nconcurrency:\n  group: cloudflare-production\n  cancel-in-progress: false\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    environment: production\n    env:\n      CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}\n      CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}\n      ALCHEMY_PASSWORD: \${{ secrets.ALCHEMY_PASSWORD }}\n    steps:\n      - uses: actions/checkout@v4\n      - uses: oven-sh/setup-bun@v2\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n      - run: corepack enable\n      - name: Load application secrets\n        env:\n          APP_ENV: \${{ secrets.APP_ENV }}\n        run: printf '%s\\n' "$APP_ENV" > apps/web/.env\n      - run: ${config.packageManager} install\n      - run: ${run} env:generate\n      - run: ${run} db:generate\n      - run: ${run} check-types\n      - run: ${run} deploy${config.packageManager === "npm" ? " --" : ""} --stage production\n        working-directory: packages/infra\n`,
  );
}
