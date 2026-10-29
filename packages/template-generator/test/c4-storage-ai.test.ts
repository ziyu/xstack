import { expect, test } from "bun:test";

import type { ProjectConfig } from "@xstack/types";

import { generate } from "../src/generator";
import { EMBEDDED_TEMPLATES } from "../src/templates.generated";
import type { VirtualNode } from "../src/types";

const config: ProjectConfig = {
  projectName: "c4-media",
  projectDir: "/tmp/c4-media",
  relativePath: "c4-media",
  frontend: ["react-router"],
  backend: "hono",
  runtime: "node",
  api: "none",
  database: "sqlite",
  orm: "drizzle",
  dbSetup: "none",
  webDeploy: "none",
  serverDeploy: "none",
  addons: [],
  packageManager: "bun",
  git: false,
  install: false,
  apps: [
    { id: "customer", type: "web-frontend", stack: { framework: "react-router" } },
    { id: "operator", type: "admin", stack: { framework: "react-router" } },
    {
      id: "media-service",
      type: "backend",
      stack: { framework: "hono", runtime: "node", api: "none" },
    },
  ],
  product: {
    features: ["auth", "admin", "storage", "ai", "credits"],
    providers: { auth: [], storage: ["s3"], ai: ["google", "openai-compatible"] },
  },
};
function files(node: VirtualNode, output = new Map<string, string>()) {
  if (node.type === "file") output.set(node.path, node.content);
  else for (const child of node.children) files(child, output);
  return output;
}
async function render(selected = config, templates = EMBEDDED_TEMPLATES) {
  const result = await generate({ config: selected, templates, trace: true });
  if (result.isErr()) throw result.error;
  return { output: files(result.value.root), provenance: result.value.provenance! };
}

test("C4 storage and AI keep services, SDKs, env and integrations on the declared backend", async () => {
  for (const database of ["sqlite", "postgres"] as const) {
    const { output, provenance } = await render({ ...config, database });
    for (const name of ["storage", "ai"]) {
      expect(output.has(`apps/media-service/src/lib/native/${name}.ts`)).toBe(true);
      expect(output.has(`apps/media-service/src/lib/${name}-http.ts`)).toBe(true);
      expect(output.has(`packages/${name}/src/index.ts`)).toBe(true);
    }
    for (const integration of ["ai-credits", "ai-storage"])
      expect(output.has(`apps/media-service/src/integrations/${integration}.ts`)).toBe(true);
    expect(
      new Set(
        provenance
          .filter((record) => /^packages\/(storage|ai|db|credits)\//.test(record.path))
          .map((record) => record.source.owner),
      ),
    ).toEqual(new Set(["media-service"]));
    for (const client of ["customer", "operator"]) {
      const prefix = `apps/${client}/`;
      expect(output.has(`${prefix}src/components/storage/file-manager.tsx`)).toBe(true);
      expect(output.has(`${prefix}src/components/ai/studio.tsx`)).toBe(true);
      expect(output.has(`${prefix}src/lib/storage-contract.ts`)).toBe(true);
      expect(output.has(`${prefix}src/lib/ai-contract.ts`)).toBe(true);
      expect(output.has(`${prefix}src/integrations/ai-credits.ts`)).toBe(false);
      expect(output.has(`${prefix}src/integrations/ai-storage.ts`)).toBe(false);
      const manifest = JSON.parse(output.get(`${prefix}package.json`)!);
      const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
      for (const dependency of [
        "@c4-media/storage",
        "@c4-media/ai",
        "@c4-media/db",
        "@c4-media/credits",
        "@c4-media/app-services",
        "@aws-sdk/client-s3",
        "@aws-sdk/s3-request-presigner",
      ])
        expect(Object.hasOwn(dependencies, dependency)).toBe(false);
      const environment = output.get(`${prefix}.env.schema`)!;
      expect(environment).toBeDefined();
      const variableNames = environment
        .split("\n")
        .flatMap((line) => /^([A-Z][A-Z0-9_]*)\s*=/.exec(line)?.[1] ?? []);
      expect(variableNames).not.toContain("AI_COMPATIBLE_API_KEY");
      expect(variableNames).not.toContain("GEMINI_API_KEY");
      expect(variableNames.some((name) => name.startsWith("S3_"))).toBe(false);
    }
  }
});

test("C4 fullstack counterparts retain module and integration contributions", async () => {
  for (const framework of ["next", "tanstack-start", "nuxt"] as const) {
    const { output } = await render({
      ...config,
      frontend: [framework],
      backend: "self",
      runtime: "none",
      apps: [{ id: "product", type: "fullstack-web", stack: { framework } }],
    });
    expect(output.has("apps/product/src/lib/storage-http.ts")).toBe(true);
    expect(output.has("apps/product/src/lib/ai-http.ts")).toBe(true);
    expect(output.has("apps/product/src/integrations/ai-credits.ts")).toBe(true);
    expect(output.has("apps/product/src/integrations/ai-storage.ts")).toBe(true);
    if (framework !== "nuxt") {
      expect(output.has("apps/product/src/components/storage/file-manager.tsx")).toBe(true);
      expect(output.has("apps/product/src/components/ai/studio.tsx")).toBe(true);
      expect(output.has("apps/product/src/lib/ai-contract.ts")).toBe(true);
    }
  }
});

test("C4 missing backend integration or helper partial fails source preflight", async () => {
  for (const path of [
    "modules/ai/integrations/credits/apps/backend/src/integrations/ai-credits.ts.hbs",
    "modules/ai/integrations/storage/apps/backend/src/integrations/ai-storage.ts.hbs",
    "modules/ai/shared/partials/ai-http.hbs",
    "modules/storage/shared/partials/storage-http.hbs",
  ]) {
    const templates = new Map(EMBEDDED_TEMPLATES);
    templates.delete(path);
    const result = await generate({ config, templates });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.phase).toBe("contributions");
  }
});
