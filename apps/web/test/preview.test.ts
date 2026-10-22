import { describe, expect, test } from "bun:test";

import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import type { VirtualNode } from "@xstack/template-generator";

import { POST } from "../src/app/api/rpc/[[...rest]]/route";
import { DEFAULT_STACK, PRESET_TEMPLATES } from "../src/lib/constant";
import { resolveStackCompatibility } from "../src/lib/stack-compatibility";
import { StackStateSchema, stackStateToConfig } from "../src/lib/stack-schema";
import { loadStackParams } from "../src/lib/stack-url-state";
import { generateStackCommand, generateStackUrlFromState } from "../src/lib/stack-utils";
import type { router } from "../src/server/router";

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
    });
  }

  test("normalizes project names consistently and uses the folder basename", async () => {
    for (const projectName of ["My App", "apps/My App"]) {
      const input = StackStateSchema.parse({ ...DEFAULT_STACK, projectName });
      const preview = await client.preview(input);
      expect(JSON.parse(files(preview.root).get("package.json")!).name).toBe("My-App");
    }
  });

  test("repairs incompatible shared choices before generating framework-specific files", async () => {
    const input = StackStateSchema.parse({
      ...DEFAULT_STACK,
      webFrontend: ["nuxt"],
      backend: "hono",
      runtime: "bun",
      api: "trpc",
    });
    const preview = await client.preview(input);
    const output = files(preview.root);
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
