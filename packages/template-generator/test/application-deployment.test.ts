import { expect, test } from "bun:test";

import type { ProjectConfig } from "@xstack/types";
import { parse } from "yaml";

import { generate } from "../src/generator";
import { EMBEDDED_TEMPLATES } from "../src/templates.generated";
import type { VirtualNode } from "../src/types";
const base: ProjectConfig = {
  projectName: "deploy-model",
  projectDir: "/tmp/deploy-model",
  relativePath: "deploy-model",
  frontend: ["react-router"],
  backend: "hono",
  runtime: "node",
  api: "orpc",
  database: "none",
  orm: "none",
  dbSetup: "none",
  webDeploy: "none",
  serverDeploy: "none",
  addons: [],
  packageManager: "bun",
  git: false,
  install: false,
  product: { features: [] },
  apps: [
    { id: "public-site", type: "web-frontend", stack: { framework: "react-router" } },
    { id: "operations", type: "admin", stack: { framework: "react-router" } },
    { id: "gateway", type: "backend", stack: { framework: "hono", runtime: "node", api: "orpc" } },
    { id: "maintenance", type: "cli", stack: { framework: "node" } },
  ],
};
function files(node: VirtualNode, out = new Map<string, string>()) {
  if (node.type === "file") out.set(node.path, node.content);
  else for (const child of node.children) files(child, out);
  return out;
}
test("named Docker services and PWA ownership do not mutate independent applications", async () => {
  const result = await generate({
    config: { ...base, webDeploy: "docker", serverDeploy: "docker", addons: ["pwa"] },
    templates: EMBEDDED_TEMPLATES,
  });
  if (result.isErr()) throw result.error;
  const output = files(result.value.root);
  const compose = parse(output.get("docker-compose.yml")!);
  expect(Object.keys(compose.services).sort()).toEqual(["gateway", "operations", "public-site"]);
  for (const id of ["gateway", "operations", "public-site"])
    expect(compose.services[id].build.dockerfile).toBe(`apps/${id}/Dockerfile`);
  expect(compose.services["public-site"].environment.SERVER_URL).toBe("http://gateway:3000");
  const cli = JSON.parse(output.get("apps/maintenance/package.json")!);
  expect(cli.dependencies?.["vite-plugin-pwa"]).toBeUndefined();
  expect(output.has("apps/maintenance/Dockerfile")).toBe(false);
});
test("named Vercel applications have separate configurations and retained per-app commands", async () => {
  const result = await generate({
    config: { ...base, webDeploy: "vercel", serverDeploy: "vercel" },
    templates: EMBEDDED_TEMPLATES,
  });
  if (result.isErr()) throw result.error;
  const output = files(result.value.root);
  for (const id of ["gateway", "operations", "public-site"])
    expect(output.has(`vercel.${id}.json`)).toBe(true);
  expect(output.has("vercel.maintenance.json")).toBe(false);
  const scripts = JSON.parse(output.get("package.json")!).scripts;
  for (const id of ["gateway", "operations", "public-site", "maintenance"])
    expect(scripts[`dev:${id}`]).toBeDefined();
});
