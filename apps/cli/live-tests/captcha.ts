import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { resolve, sep } from "node:path";

import { z } from "zod";

/** HTTP protocol fixture against a running generated app, never production.
 * Start captcha-provider.ts and launch Next with captcha-preload.mjs first.
 */
const [projectDirectory, origin, fixtureOrigin = "http://127.0.0.1:4399"] = process.argv.slice(2);
if (!projectDirectory || !origin)
  throw new Error(
    "Usage: bun apps/cli/live-tests/captcha.ts <generated-project> <app-origin> [fixture-origin]",
  );
for (const value of [origin, fixtureOrigin]) {
  if (
    !new URL(value).protocol.startsWith("http") ||
    !["localhost", "127.0.0.1"].includes(new URL(value).hostname)
  ) {
    throw new Error("Only disposable loopback HTTP applications are permitted");
  }
}
if (!resolve(projectDirectory).startsWith(resolve(import.meta.dir, "../.smoke") + sep))
  throw new Error("Project must be under apps/cli/.smoke");
const database = new Database(`${projectDirectory}/local.db`, { create: false, readwrite: true });
// The full preset persists Better Auth rate limits. Clear only this disposable
// fixture's counters before each scenario; rate limiting is tested separately.
const persistentRateLimit = database
  .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rate_limit'")
  .get();
const email = `captcha-${Date.now()}@example.test`;
const password = "Captcha-Protocol-Password-123!";
const body = { name: "Captcha Protocol", email, password };
async function token(
  action = "signup",
  options: { hostname?: string; ageSeconds?: number; success?: boolean } = {},
) {
  const response = await fetch(`${fixtureOrigin}/issue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, hostname: new URL(origin!).hostname, ...options }),
  });
  assert.equal(response.status, 200);
  return z.object({ token: z.string() }).parse(await response.json()).token;
}
type AuthPayload =
  | { name: string; email: string; password: string }
  | { email: string; password: string }
  | { email: string; redirectTo: string }
  | { token: string; newPassword: string }
  | { email: string };
async function post(
  path: string,
  data: AuthPayload,
  captcha?: string,
  requestOrigin: string | null = origin!,
) {
  if (persistentRateLimit) database.exec("DELETE FROM rate_limit");
  const headers = new Headers({ "content-type": "application/json" });
  if (requestOrigin) headers.set("origin", requestOrigin);
  if (captcha) headers.set("x-captcha-token", captcha);
  return fetch(`${origin}/api/auth/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(data),
  });
}
async function rejected(response: Response, code: string) {
  const text = await response.text();
  const context = `${response.url}: expected ${code}; HTTP ${response.status}: ${text}`;
  assert.ok(response.status >= 400 && response.status < 500, context);
  const parsed = z.object({ code: z.string() }).safeParse(JSON.parse(text));
  assert.ok(parsed.success, context);
  assert.equal(parsed.data.code, code, context);
}
function users() {
  return z
    .object({ count: z.number() })
    .parse(database.query("SELECT count(*) AS count FROM user WHERE email = ?").get(email)).count;
}
try {
  for (const [path, data] of [
    ["sign-up/email", body],
    ["sign-in/email", { email, password }],
    ["request-password-reset", { email, redirectTo: `${origin}/en/reset-password` }],
    ["reset-password", { token: "invalid-reset-token", newPassword: password }],
    ["send-verification-email", { email }],
  ] as const)
    await rejected(await post(path, data), "CAPTCHA_REQUIRED");
  await rejected(await post("sign-up/email", body, "not-a-token"), "CAPTCHA_INVALID");
  await rejected(await post("sign-up/email", body, await token("login")), "CAPTCHA_INVALID");
  await rejected(
    await post("sign-up/email", body, await token("signup", { hostname: "attacker.example" })),
    "CAPTCHA_INVALID",
  );
  await rejected(
    await post("sign-up/email", body, await token("signup", { ageSeconds: 301 })),
    "CAPTCHA_INVALID",
  );
  await rejected(
    await post("sign-up/email", body, await token("signup", { ageSeconds: -90 })),
    "CAPTCHA_INVALID",
  );
  await rejected(
    await post("sign-up/email", body, await token("signup", { success: false })),
    "CAPTCHA_INVALID",
  );
  const valid = await token();
  const foreign = await post("sign-up/email", body, valid, "https://attacker.example");
  assert.equal(foreign.status, 403);
  await rejected(await post("sign-up/email", body, valid, null), "CAPTCHA_ORIGIN_REJECTED");
  assert.equal(users(), 0, "Rejected tokens never create a user");
  const created = await post("sign-up/email", body, valid);
  assert.equal(created.status, 200, await created.text());
  assert.equal(users(), 1, "A valid challenge unlocks the real generated signup");
  await rejected(
    await post("sign-up/email", { ...body, email: `replay-${email}` }, valid),
    "CAPTCHA_INVALID",
  );
  assert.equal(
    z
      .object({ count: z.number() })
      .parse(
        database.query("SELECT count(*) AS count FROM user WHERE email = ?").get(`replay-${email}`),
      ).count,
    0,
  );
  // Email confirmation is outside this fixture. Mark this disposable account confirmed
  // to exercise the real login boundary whether or not the email module is selected.
  database.query("UPDATE user SET email_verified = 1 WHERE email = ?").run(email);
  const signedIn = await post("sign-in/email", { email, password }, await token("login"));
  assert.equal(signedIn.status, 200, await signedIn.clone().text());
  const cookie = signedIn.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
  assert.ok(cookie);
  const session = await fetch(`${origin}/api/auth/get-session`, { headers: { cookie } });
  const sessionData = z
    .object({ user: z.object({ email: z.string() }) })
    .parse(await session.json());
  assert.equal(
    sessionData.user.email,
    email,
    "A normal authenticated session remains accessible without captcha",
  );
  const publicConfig = await fetch(`${origin}/api/captcha/config`);
  assert.deepEqual(
    await publicConfig.json(),
    { siteKey: "captcha-fixture-site" },
    "Configuration exposes only the public site key",
  );
  console.log(
    "Captcha generated auth HTTP fixture passed: raw bypass, signatures, host/action/time, replay, origin, signup, login, session and public config. This is NOT live Cloudflare verification.",
  );
} finally {
  database.close();
}
