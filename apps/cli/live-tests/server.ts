import type { RenderConfig } from "@xstack/template-generator";
import { expect, request } from "@playwright/test";
import { z } from "zod";

import type { DatabaseAssertions } from "./database";
import { authorizeDeployment } from "./protection";
import type { Deployment } from "./providers";

export async function verifyServer(
  config: RenderConfig,
  deployment: Deployment,
  stage: string,
  database?: DatabaseAssertions,
  previousStage?: string,
) {
  if (!deployment.server) throw new Error("Server verification requires a server URL");
  const origin = new URL(deployment.server).origin;
  const headers = new Headers({
    Origin:
      deployment.web ?? (origin.startsWith("http://localhost:") ? "http://localhost:3001" : origin),
  });
  const context = await request.newContext({
    extraHTTPHeaders: Object.fromEntries(headers),
    timeout: 30_000,
  });
  const rpc = async (procedure: string, status = 200) => {
    const trpc = config.api === "trpc";
    const response = await context.fetch(
      `${deployment.server}/${trpc ? `trpc/${procedure}` : `rpc/${procedure.replaceAll(".", "/")}`}`,
      {
        method: trpc ? "GET" : "POST",
        data: trpc ? undefined : { json: undefined },
      },
    );
    expect(response.status(), procedure).toBe(status);
    if (status !== 200) return undefined;
    const body = await response.json();
    return trpc
      ? z.object({ result: z.object({ data: z.json() }) }).parse(body).result.data
      : z.object({ json: z.json().optional() }).parse(body).json;
  };
  try {
    await authorizeDeployment(context, deployment);
    expect((await context.get(deployment.server)).status(), "Server health").toBe(200);
    if (config.api !== "none") expect(await rpc("healthCheck")).toBe("OK");
    if (config.auth === "better-auth") {
      if (config.api !== "none") await rpc("privateData", 401);
      const email = `server-${previousStage ?? stage}@example.test`;
      const signedIn = await context.post(
        `${origin}/api/auth/${previousStage ? "sign-in" : "sign-up"}/email`,
        {
          data: { name: "Live Test", email, password: "Live-test-only-password-2026!" },
        },
      );
      expect(signedIn.status(), "Authentication").toBe(200);
      const session = await context.get(`${origin}/api/auth/get-session`);
      expect(session.status(), "Session request").toBe(200);
      const body = z.object({ user: z.object({ email: z.string() }) }).parse(await session.json());
      expect(body.user.email).toBe(email);
      await database?.user(email);
      if (config.api !== "none")
        expect(await rpc("privateData")).toMatchObject({
          message: "This is private",
          user: { email },
        });
    }
    if (config.auth === "better-auth") {
      expect((await context.post(`${origin}/api/auth/sign-out`, { data: {} })).status()).toBe(200);
      expect(await (await context.get(`${origin}/api/auth/get-session`)).json()).toBeNull();
      if (config.api !== "none") await rpc("privateData", 401);
    }
  } finally {
    await context.dispose();
  }
}
