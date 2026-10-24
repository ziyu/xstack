import assert from "node:assert/strict";
import { resolve, sep } from "node:path";

import { z } from "zod";

// Runs the same generated product contracts on Next.js, TanStack Start and Nuxt.
// Auth cookies must come from real local signup/login, including configured captcha/email.
const project = resolve(process.argv[2] ?? "");
const origin = process.argv[3] ?? "";
if (!project.startsWith(resolve(import.meta.dir, "../.smoke") + sep))
  throw new Error("Disposable .smoke project required");
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw new Error("Loopback origin required");
const cookie = z.string().min(1).parse(process.env.PRODUCT_USER_COOKIE);
const userSchema = z.object({ user: z.object({ id: z.string(), email: z.string() }) });
const session = await fetch(`${origin}/api/auth/get-session`, { headers: { cookie } });
assert.equal(session.status, 200);
const { user } = userSchema.parse(await session.json());
for (const path of ["/en", "/zh-CN", "/en/pricing", "/en/blog", "/robots.txt", "/sitemap.xml"]) {
  const response = await fetch(origin + path);
  assert.equal(response.status, 200, `${path}: ${await response.clone().text()}`);
  const body = await response.text();
  if (path === "/sitemap.xml") {
    assert.match(body, /<urlset/);
    assert.doesNotMatch(body, /<loc>[^<]*\/(admin|dashboard|api)(?:\/|<)/);
  }
  if (path === "/en/pricing") assert.match(body, /rel="canonical"/);
}
for (const path of [
  "/en/dashboard",
  "/en/dashboard/files",
  "/en/dashboard/ai",
  "/en/dashboard/credits",
  "/en/dashboard/billing",
  "/en/dashboard/affiliate",
  "/en/dashboard/settings",
]) {
  const anonymous = await fetch(origin + path, { redirect: "manual" });
  assert.ok([302, 303, 307, 308].includes(anonymous.status), `${path} must require login`);
  const authenticated = await fetch(origin + path, { headers: { cookie }, redirect: "manual" });
  assert.equal(authenticated.status, 200, `${path} must render with a real session`);
}
for (const path of ["/api/ai", "/api/affiliate"]) {
  assert.equal((await fetch(origin + path)).status, 401, `${path} anonymous access`);
  const response = await fetch(origin + path, { headers: { cookie } });
  assert.equal(response.status, 200, `${path} signed-in access`);
}
const invalidWebhook = await fetch(`${origin}/api/payment/webhook/stripe`, {
  method: "POST",
  headers: { "stripe-signature": "t=1,v1=invalid" },
  body: "{}",
});
assert.equal(invalidWebhook.status, 400);
console.log(
  `PASS framework product HTTP contract: ${user.email}; public SEO, SSR sessions, all dashboard routes, protected APIs and forged webhook rejection. No external provider acceptance implied.`,
);
