import { describe, expect, test } from "bun:test";
import { inflateRawSync } from "node:zlib";

import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import type { VirtualNode } from "@xstack/template-generator";
import type { ApplicationSelection } from "@xstack/types";

import { POST as exportProject } from "../src/app/api/export/route";
import { POST } from "../src/app/api/rpc/[[...rest]]/route";
import { DEFAULT_STACK, PRESET_TEMPLATES } from "../src/lib/constant";
import { findMatchingPreset } from "../src/lib/preset-stacks";
import { applicationIssues } from "../src/lib/stack-applications";
import { applyStackUpdate, resolveStackCompatibility } from "../src/lib/stack-compatibility";
import { productPlan } from "../src/lib/stack-features";
import { StackStateSchema, stackStateToConfig } from "../src/lib/stack-schema";
import { loadStackParams, serializeStackParams } from "../src/lib/stack-url-state";
import { stackParsers } from "../src/lib/stack-url-state.client";
import { generateStackCommand, generateStackUrlFromState } from "../src/lib/stack-utils";
import type { router } from "../src/server/router";

const cliApp: ApplicationSelection = { id: "tools", type: "cli", stack: { framework: "node" } };
const splitApps: ApplicationSelection[] = [
  {
    id: "site",
    type: "web-frontend",
    stack: { framework: "react-router" },
    bindings: { backend: "server" },
  },
  {
    id: "admin",
    type: "admin",
    stack: { framework: "react-router" },
    bindings: { backend: "server" },
  },
  { id: "server", type: "backend", stack: { framework: "hono", runtime: "bun", api: "orpc" } },
];

const client: RouterClient<typeof router> = createORPCClient(
  new RPCLink({
    url: "http://localhost/api/rpc",
    fetch: (request, init) => POST(new Request(request, init)),
  }),
);

function files(node: VirtualNode, result = new Map<string, string>()) {
  if (node.type === "file") result.set(node.path, node.content);
  else for (const child of node.children) files(child, result);
  return result;
}

test("Builder preserves split topology when validating native identity and previewing server ownership", async () => {
  const input = StackStateSchema.parse({
    ...DEFAULT_STACK,
    apps: splitApps.map((app) =>
      app.type === "backend" ? { ...app, stack: { ...app.stack, api: "none" } } : app,
    ),
    features: ["auth", "admin"],
    providers: { auth: [] },
    database: "sqlite",
    orm: "drizzle",
    dbSetup: "none",
  });
  expect(productPlan(input).issues.filter((issue) => issue.level === "error")).toEqual([]);
  expect(productPlan(input).modules.find((module) => module.manifest.id === "admin")?.variant).toBe(
    "native",
  );
  const output = files((await client.preview(input)).root);
  for (const app of ["site", "admin"]) {
    const dependencies = JSON.parse(output.get(`apps/${app}/package.json`)!).dependencies;
    for (const name of ["auth", "db", "events", "permissions"])
      expect(dependencies[`@${input.projectName}/${name}`]).toBeUndefined();
  }
});

describe("builder preview over oRPC", () => {
  for (const preset of PRESET_TEMPLATES) {
    test(`generates ${preset.name} from a shared stack URL`, async () => {
      const resolved = resolveStackCompatibility(preset.stack).stack;
      const shared = await loadStackParams(
        Promise.resolve(new URL(generateStackUrlFromState(resolved))),
      );
      const input = StackStateSchema.parse(shared);
      const preview = await client.preview(input);
      const output = files(preview.root);
      expect(preview.fileCount).toBe(output.size);
      expect(JSON.parse(output.get("package.json")!).name).toBe(
        stackStateToConfig(resolved).projectName,
      );
      expect(generateStackCommand(shared)).toBe(generateStackCommand(resolved));
      for (const app of shared.apps ?? []) {
        expect(output.has(`apps/${app.id}/package.json`)).toBe(true);
        if (app.type === "fullstack-web") {
          const framework = app.stack.framework!;
          const dependency = framework === "tanstack-start" ? "@tanstack/react-start" : framework;
          expect(
            JSON.parse(output.get(`apps/${app.id}/package.json`)!).dependencies[dependency],
          ).toBeDefined();
        }
      }
      if (shared.database !== "none") {
        expect(
          JSON.parse(output.get("packages/db/package.json")!).dependencies[
            shared.database === "postgres" ? "pg" : "@libsql/client"
          ],
        ).toBeDefined();
      }
      expect(findMatchingPreset(input)?.id).toBe(preset.id);
    });
  }

  test("replaces a customized stack with a complete preset while retaining the project name", async () => {
    let current: typeof DEFAULT_STACK = { ...DEFAULT_STACK, projectName: "my-custom-project" };
    for (const preset of PRESET_TEMPLATES) {
      current = applyStackUpdate(current, {
        ...preset.stack,
        projectName: current.projectName,
      }).stack;
      expect(findMatchingPreset(current)?.id).toBe(preset.id);
      expect(current.projectName).toBe("my-custom-project");
      const customized = applyStackUpdate(current, { packageManager: "npm", providers: {} }).stack;
      expect(findMatchingPreset(customized)).toBeUndefined();
      const shared = StackStateSchema.parse(
        await loadStackParams(Promise.resolve(new URL(generateStackUrlFromState(customized)))),
      );
      expect(findMatchingPreset(shared)).toBeUndefined();
      const output = files((await client.preview(shared)).root);
      expect(JSON.parse(output.get("package.json")!).packageManager).toStartWith("npm@");
      current = customized;
    }
  });

  test("normalizes project names consistently and uses the folder basename", async () => {
    for (const projectName of ["My App", "apps/My App"]) {
      const input = StackStateSchema.parse({ ...DEFAULT_STACK, projectName });
      const preview = await client.preview(input);
      expect(JSON.parse(files(preview.root).get("package.json")!).name).toBe("My-App");
    }
  });

  test("rejects incompatible shared choices without substituting another API", async () => {
    const input = StackStateSchema.parse({
      ...DEFAULT_STACK,
      apps: undefined,
      webFrontend: ["nuxt"],
      backend: "hono",
      runtime: "bun",
      api: "trpc",
    });
    expect(resolveStackCompatibility(input).stack.api).toBe("trpc");
    await expect(client.preview(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const output = files((await client.preview({ ...input, api: "orpc" })).root);
    const api = JSON.parse(output.get("packages/api/package.json")!);
    expect(api.dependencies["@orpc/server"]).toBeDefined();
    expect(api.dependencies["@trpc/server"]).toBeUndefined();
  });

  test("preserves providers and options across a shared URL and renders the chosen product", async () => {
    const preset = PRESET_TEMPLATES.find((preset) => preset.id === "saas-global")!;
    const selected = {
      ...preset.stack,
      projectName: "product-check",
      providers: { auth: [], email: ["smtp"], payment: ["polar"] },
      moduleOptions: { i18n: { locales: "zh-CN" }, credits: { signupBonus: 50 } },
    };
    const shared = await loadStackParams(
      Promise.resolve(new URL(generateStackUrlFromState(selected))),
    );
    expect(shared.providers).toEqual(selected.providers);
    expect(shared.moduleOptions).toEqual(selected.moduleOptions);
    const output = files((await client.preview(shared)).root);
    expect(
      JSON.parse(output.get("packages/email/package.json")!).dependencies.nodemailer,
    ).toBeDefined();
    expect(output.has("packages/email/src/providers/resend.ts")).toBe(false);
    expect(output.has("packages/payment/src/providers/polar.ts")).toBe(true);
    expect(output.has("packages/payment/src/providers/stripe.ts")).toBe(false);
    expect(output.get("apps/web/.env.schema")).not.toContain("GOOGLE_CLIENT_ID");
    expect(output.get("apps/web/.env.schema")).not.toContain("GITHUB_CLIENT_ID");
    expect(output.get("packages/i18n/src/config.ts")).toContain('defaultLocale: Locale = "zh-CN"');
    expect(output.get("packages/i18n/src/messages/index.ts")).not.toContain('"./en"');
    expect(output.get("apps/web/src/integrations/credits-signup.ts")).toContain(
      "SIGNUP_BONUS = 50",
    );
    expect(generateStackCommand(shared)).toContain("auth:none");
  });

  test("rejects invalid module options and provider selections instead of dropping features", async () => {
    for (const update of [
      { providers: { payment: ["missing-provider"] } },
      { providers: { email: ["resend", "smtp"] } },
      { moduleOptions: { credits: { signupBonus: -1 } } },
    ]) {
      const input = StackStateSchema.parse({
        ...PRESET_TEMPLATES.find((preset) => preset.id === "saas-global")!.stack,
        ...update,
      });
      await expect(client.preview(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  test("preserves full feature selections when switching native frameworks", async () => {
    const full = PRESET_TEMPLATES.find((preset) => preset.id === "full")!.stack;
    for (const framework of ["tanstack-start", "nuxt"] as const) {
      const selected = {
        ...full,
        apps: [{ id: "web", type: "fullstack-web", stack: { framework } }],
      };
      const resolved = resolveStackCompatibility(selected).stack;
      expect(resolved.features).toEqual(full.features);
      const shared = StackStateSchema.parse(
        await loadStackParams(Promise.resolve(new URL(generateStackUrlFromState(resolved)))),
      );
      expect(shared.webFrontend).toEqual([framework]);
      expect(shared.providers).toEqual(full.providers);
      await client.preview(shared);
    }
  });

  test("shares and previews the selected SMS provider without enabling unselected vendors", async () => {
    for (const provider of ["aliyun", "tencent", "twilio"]) {
      const selected = {
        ...DEFAULT_STACK,
        features: ["auth", "sms"],
        providers: { auth: [], sms: [provider] },
      };
      const shared = await loadStackParams(
        Promise.resolve(new URL(generateStackUrlFromState(selected))),
      );
      expect(shared.providers).toEqual(selected.providers);
      const output = files((await client.preview(shared)).root);
      expect(output.has("apps/web/src/app/[lang]/login/phone/page.tsx")).toBe(true);
      expect(output.has(`packages/sms/src/providers/${provider}.ts`)).toBe(true);
      for (const other of ["aliyun", "tencent", "twilio"].filter((id) => id !== provider)) {
        expect(output.has(`packages/sms/src/providers/${other}.ts`)).toBe(false);
      }
    }
  });

  test("preserves WeChat selection through sharing and exposes only server-side credential keys", async () => {
    const stack = { ...DEFAULT_STACK, features: ["auth"], providers: { auth: ["wechat"] } };
    const shared = await loadStackParams(
      Promise.resolve(new URL(generateStackUrlFromState(stack))),
    );
    expect(shared.providers.auth).toEqual(["wechat"]);
    const output = files((await client.preview(shared)).root);
    expect(output.get("apps/web/.env.schema")).toContain("WECHAT_CLIENT_ID");
    expect(output.get("apps/web/.env.schema")).toContain("WECHAT_CLIENT_SECRET");
    expect(output.get("apps/web/.env.schema")).not.toContain("GOOGLE_CLIENT_ID");
    expect(output.get("apps/web/.env.schema")).not.toContain("NEXT_PUBLIC_WECHAT");
    expect(generateStackCommand(shared)).toContain("auth:wechat");
  });

  test("rejects invalid payloads at the HTTP boundary", async () => {
    for (const json of [
      null,
      { webFrontend: "next" },
      { backend: "invented" },
      { projectName: "-bad" },
      { projectName: "/" },
    ]) {
      const response = await POST(
        new Request("http://localhost/api/rpc/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json }),
        }),
      );
      expect(response.status).toBe(400);
    }
    await expect(client.preview({ projectName: "-bad" })).rejects.toBeInstanceOf(ORPCError);
  });
});

describe("explicit application state", () => {
  test("keeps optional schema absence distinct from an explicit empty layout", async () => {
    expect(StackStateSchema.parse({}).apps).toBeUndefined();
    expect(StackStateSchema.parse({ apps: [] }).apps).toEqual([]);
    expect(stackParsers.apps.parse("[]")).toEqual([]);
    expect(stackParsers.apps.parse(JSON.stringify([cliApp]))).toEqual([cliApp]);
    expect(stackParsers.apps.serialize([cliApp])).toBe(JSON.stringify([cliApp]));
    const fresh = await loadStackParams(Promise.resolve(new URL("https://xstack.dev/new")));
    expect(fresh.apps).toEqual(DEFAULT_STACK.apps);
    const legacy = await loadStackParams(
      Promise.resolve(new URL("https://xstack.dev/new?fe-w=next&be=self-next")),
    );
    expect(legacy.apps).toBeUndefined();
    const empty = await loadStackParams(Promise.resolve(new URL("https://xstack.dev/new?apps=[]")));
    expect(empty.apps).toEqual([]);
    expect(() => productPlan(empty)).not.toThrow();
    expect(() => generateStackCommand(empty)).not.toThrow();
    await expect(client.preview(empty)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: applicationIssues(empty).join("\n"),
    });
    const malformed = await loadStackParams(
      Promise.resolve(new URL("https://xstack.dev/new?apps=broken")),
    );
    expect(malformed.apps).toEqual([]);
  });

  for (const [name, apps] of [
    ["web plus CLI", [{ id: "web", type: "fullstack-web", stack: { framework: "next" } }, cliApp]],
    ["split plus CLI", [...splitApps, cliApp]],
  ] satisfies [string, ApplicationSelection[]][]) {
    test(`roundtrips and previews ${name}`, async () => {
      const selected = StackStateSchema.parse({
        ...DEFAULT_STACK,
        apps,
        features: ["none"],
        providers: {},
        moduleOptions: {},
        database: name === "web plus CLI" ? "sqlite" : "none",
        orm: name === "web plus CLI" ? "drizzle" : "none",
      });
      for (const url of [
        generateStackUrlFromState(selected),
        `https://xstack.dev/new${serializeStackParams(selected)}`,
      ]) {
        const shared = await loadStackParams(Promise.resolve(new URL(url)));
        expect(shared.apps).toEqual(apps);
        expect(StackStateSchema.parse(JSON.parse(JSON.stringify(shared))).apps).toEqual(apps);
        expect(stackStateToConfig(shared).apps).toEqual(apps);
        expect(applicationIssues(shared)).toEqual([]);
        const command = generateStackCommand(shared);
        expect(command).toContain(`--apps '${JSON.stringify(apps)}'`);
        expect(command).not.toContain("--frontend ");
        expect(command).not.toContain("--backend ");
        expect(command).not.toContain("--runtime ");
        expect(command).not.toContain("--api ");
        const output = files((await client.preview(shared)).root);
        for (const app of apps) expect(output.has(`apps/${app.id}/package.json`)).toBe(true);
        expect(output.has("apps/tools/src/index.js")).toBe(true);
        expect(shared.backend).toBe(name === "web plus CLI" ? "self-next" : "hono");
        expect(shared.webFrontend).toEqual([name === "web plus CLI" ? "next" : "react-router"]);
      }
    });
  }

  test("reports overlap and missing bindings without discarding apps or features", async () => {
    const web: ApplicationSelection = {
      id: "web",
      type: "fullstack-web",
      stack: { framework: "next" },
    };
    for (const apps of [
      [web, ...splitApps],
      splitApps.filter((app) => app.id !== "server"),
      [web, { ...web }],
    ]) {
      const selected = { ...DEFAULT_STACK, apps, features: ["auth", "payment"] };
      const shared = await loadStackParams(
        Promise.resolve(new URL(generateStackUrlFromState(selected))),
      );
      expect(shared.apps).toEqual(apps);
      expect(shared.features).toEqual(selected.features);
      const updated = applyStackUpdate(selected, { packageManager: "npm" }).stack;
      expect(updated.apps).toEqual(apps);
      expect(updated.features).toEqual(selected.features);
      const issues = applicationIssues(shared);
      expect(issues.length).toBeGreaterThan(0);
      await expect(client.preview(shared)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: issues.join("\n"),
      });
    }
  });

  test("rejects unsupported native module combinations rather than repairing selections", async () => {
    for (const update of [
      { apps: splitApps, features: ["payment"] },
      { database: "none", orm: "none", features: ["none"] },
      { database: "postgres", orm: "prisma", features: ["none"] },
    ]) {
      const selected = StackStateSchema.parse({ ...DEFAULT_STACK, ...update });
      const resolved = resolveStackCompatibility(selected).stack;
      expect(resolved.apps).toEqual(selected.apps);
      expect(resolved.features).toEqual(selected.features);
      expect(resolved.addons).toEqual(selected.addons);
      expect(resolved.webDeploy).toEqual(selected.webDeploy);
      expect(resolved.dbSetup).toEqual(selected.dbSetup);
      const issues = applicationIssues(resolved);
      expect(issues.length).toBeGreaterThan(0);
      await expect(client.preview(resolved)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: issues.join("\n"),
      });
    }
  });

  test("previews supported stack authentication without claiming native admin support", async () => {
    const selected = StackStateSchema.parse({
      ...DEFAULT_STACK,
      apps: splitApps,
      features: ["auth"],
      providers: { auth: [] },
    });
    expect(applicationIssues(selected)).toEqual([]);
    const output = files((await client.preview(selected)).root);
    expect(output.has("apps/server/src/services.ts")).toBe(true);
    expect(output.has("apps/site/src/routes/login.tsx")).toBe(true);
    expect(output.has("packages/permission/package.json")).toBe(false);
  });
});

/** Minimal reader for the archives this app writes: local headers, deflate or stored payloads. */
function readZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = new Map<string, Uint8Array>();
  let offset = 0;
  while (offset + 30 <= bytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    const payload = bytes.subarray(start, start + compressedSize);
    entries.set(name, method === 8 ? new Uint8Array(inflateRawSync(payload)) : payload);
    offset = start + compressedSize;
  }
  return entries;
}

describe("project source export", () => {
  const exportRequest = (body: string) =>
    new Request("http://localhost/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

  test("archives every generated file with real binary assets", async () => {
    const stack = StackStateSchema.parse(DEFAULT_STACK);
    const response = await exportProject(exportRequest(JSON.stringify(stack)));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="my-xstack-app.zip"',
    );

    const archive = readZip(new Uint8Array(await response.arrayBuffer()));
    const preview = files((await client.preview(stack)).root);
    const prefix = "my-xstack-app/";
    expect(archive.has(`${prefix}package.json`)).toBe(true);
    expect(response.headers.get("x-file-count")).toBe(String(preview.size));
    for (const [path, content] of preview) {
      if (content === "[Binary file]") continue;
      expect(new TextDecoder().decode(archive.get(`${prefix}${path}`))).toBe(content);
    }
    const favicon = archive.get(`${prefix}apps/web/src/app/favicon.ico`)!;
    expect([...favicon.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
  });

  test("rejects stacks that cannot be generated", async () => {
    const invalidName = await exportProject(
      exportRequest(JSON.stringify({ ...DEFAULT_STACK, projectName: "-bad" })),
    );
    expect(invalidName.status).toBe(400);
    expect(await invalidName.json()).toEqual({
      message: "Project name cannot start with a dash",
    });

    const malformed = await exportProject(exportRequest("null"));
    expect(malformed.status).toBe(400);
  });
});
