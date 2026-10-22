import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

// Local provider-protocol fixture, not evidence of a successful real WeChat scan.
// Run against a disposable generated auth+wechat+credits SQLite project after db:migrate.
const project = resolve(process.argv[2] ?? "");
if (!project.startsWith(resolve(import.meta.dir, "../.smoke") + sep)) {
  throw new Error("Expected a disposable generated project inside apps/cli/.smoke");
}
// These modules belong to the runtime-selected generated application, not this repository.
const { createAuth } = await import(pathToFileURL(`${project}/packages/auth/src/index.ts`).href);
const { createDb } = await import(pathToFileURL(`${project}/packages/db/src/index.ts`).href);
const { createEventBus } = await import(
  pathToFileURL(`${project}/packages/events/src/index.ts`).href
);
const db = createDb({ DATABASE_URL: `file:${project}/local.db` });
const sqlite = new Database(`${project}/local.db`, { create: false, readwrite: true });
const events = createEventBus();
let registrations = 0;
events.on("auth.user_created", () => {
  registrations++;
});
const clientId = "wx-local-protocol-fixture";
const secret = "local-oauth-fixture-secret-not-for-production-123456789";
const identity = `openid-fixture-${crypto.randomUUID()}`;
let calls = 0;
const originalFetch = globalThis.fetch;
// Intercept only the provider HTTP boundary; execute the actual generated auth,
// Better Auth state/cookie validation and SQLite adapter without mocking those layers.
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== "https://api.weixin.qq.com") return originalFetch(input, init);
  calls++;
  if (url.pathname === "/sns/oauth2/access_token") {
    assert.equal(url.searchParams.get("appid"), clientId);
    assert.equal(url.searchParams.get("secret"), "local-client-secret");
    if (url.searchParams.get("code") === "invalid-code")
      return Response.json({ errcode: 40029, errmsg: "invalid code" });
    return Response.json({
      access_token: "fixture-access",
      refresh_token: "fixture-refresh",
      expires_in: 7200,
      openid: identity,
      scope: "snsapi_login",
    });
  }
  assert.equal(url.pathname, "/sns/userinfo");
  assert.equal(url.searchParams.get("openid"), identity);
  return Response.json({
    openid: identity,
    nickname: "WeChat fixture",
    headimgurl: "",
    privilege: [],
    email: "admin@example.test",
  });
}) as typeof fetch;
const syntheticEmail = `wechat-${createHash("sha256").update(`${clientId}:${identity}`).digest("hex").slice(0, 48)}@wechat.invalid`;
const auth = createAuth(
  {
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: "http://localhost:4391",
    WECHAT_CLIENT_ID: clientId,
    WECHAT_CLIENT_SECRET: "local-client-secret",
    ADMIN_EMAILS: `admin@example.test,${syntheticEmail}`,
  },
  db,
  events,
);
const origin = "http://localhost:4391";
async function begin(callbackURL = `${origin}/en/dashboard`) {
  const response = await auth.handler(
    new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ provider: "wechat", callbackURL, disableRedirect: true }),
    }),
  );
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  const url = new URL(body.url);
  assert.equal(url.origin, "https://open.weixin.qq.com");
  assert.equal(url.pathname, "/connect/qrconnect");
  assert.equal(url.searchParams.get("scope"), "snsapi_login");
  assert.equal(url.searchParams.get("redirect_uri"), `${origin}/api/auth/callback/wechat`);
  assert.equal(url.searchParams.has("secret"), false);
  const cookie = response.headers
    .getSetCookie()
    .map((value: string) => value.split(";")[0])
    .join("; ");
  return { state: url.searchParams.get("state")!, cookie };
}
async function callback(state: string, cookie = "", code = "fixture-code") {
  return auth.handler(
    new Request(`${origin}/api/auth/callback/wechat?${new URLSearchParams({ state, code })}`, {
      headers: { cookie },
    }),
  );
}
try {
  const start = await begin();
  const noCookie = await callback(start.state);
  assert.ok(noCookie.headers.get("location")?.includes("state_mismatch"));
  assert.equal(calls, 0, "No provider request before browser binding validates");
  const mismatch = await callback("forged-state", start.cookie);
  assert.ok(mismatch.headers.get("location")?.includes("state_mismatch"));
  assert.equal(calls, 0);
  const success = await callback(start.state, start.cookie);
  assert.equal(success.headers.get("location"), `${origin}/en/dashboard`);
  const sessionCookie = success.headers
    .getSetCookie()
    .map((value: string) => value.split(";")[0])
    .join("; ");
  const session = await (
    await auth.handler(
      new Request(`${origin}/api/auth/get-session`, { headers: { cookie: sessionCookie } }),
    )
  ).json();
  assert.equal(session.user.email, syntheticEmail);
  assert.equal(session.user.emailVerified, false);
  assert.equal(session.user.role, "user");
  assert.equal(registrations, 1);
  const replay = await callback(start.state, start.cookie);
  assert.ok(replay.headers.get("location")?.includes("state_mismatch"));
  const again = await begin();
  assert.equal(
    (await callback(again.state, again.cookie)).headers.get("location"),
    `${origin}/en/dashboard`,
  );
  assert.equal(registrations, 1, "Returning OAuth login must not create a second account");
  const invalid = await begin();
  assert.ok(
    (await callback(invalid.state, invalid.cookie, "invalid-code")).headers
      .get("location")
      ?.includes("invalid_code"),
  );
  const expired = await begin();
  const identifier = `auth-state:${expired.state}`;
  const verification = z
    .object({ value: z.string() })
    .parse(sqlite.query("SELECT value FROM verification WHERE identifier = ?").get(identifier));
  const expiredPayload = JSON.parse(verification.value);
  expiredPayload.expiresAt = 0;
  sqlite
    .query("UPDATE verification SET value = ? WHERE identifier = ?")
    .run(JSON.stringify(expiredPayload), identifier);
  const beforeExpiryCheck = calls;
  assert.ok(
    (await callback(expired.state, expired.cookie)).headers
      .get("location")
      ?.includes("state_mismatch"),
  );
  assert.equal(calls, beforeExpiryCheck, "Expired state never calls the provider");
  const unconfigured = createAuth(
    { BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: origin, WECHAT_CLIENT_ID: clientId },
    db,
    events,
  );
  const unavailable = await unconfigured.handler(
    new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ provider: "wechat", callbackURL: `${origin}/en/dashboard` }),
    }),
  );
  assert.notEqual(unavailable.status, 200, "Partial credentials must not enable WeChat");
  const outside = await auth.handler(
    new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ provider: "wechat", callbackURL: "https://attacker.invalid" }),
    }),
  );
  assert.equal(outside.status, 403);
  const forgedToken = await auth.handler(
    new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ provider: "wechat", idToken: { token: "forged" } }),
    }),
  );
  assert.notEqual(forgedToken.status, 200);
  const count = z
    .object({ count: z.number() })
    .parse(sqlite.query("SELECT count(*) AS count FROM user WHERE email = ?").get(syntheticEmail));
  assert.equal(count.count, 1);
  console.log(
    "Local WeChat protocol fixture passed: authorization URL, state/cookie binding, signup/session, repeat login, replay rejection, invalid code, external redirect, forged id-token rejection and synthetic email/admin boundaries. No real provider scan was exercised.",
  );
} finally {
  globalThis.fetch = originalFetch;
  sqlite.close();
  db.$client.close();
}
