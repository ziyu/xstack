import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

// Protocol fixture, not a real Cloudflare attestation. Only this disposable server knows
// its signing key; generated applications still call their real Siteverify adapter.
const [portText = "4399"] = process.argv.slice(2);
const port = z.coerce.number().int().min(1024).max(65535).parse(portText);
const key = process.env.CAPTCHA_FIXTURE_SIGNING_KEY;
if (!key || key.length < 32)
  throw new Error("Set CAPTCHA_FIXTURE_SIGNING_KEY to at least 32 characters");
const signingKey = key;
const payloadSchema = z.object({
  id: z.string(),
  action: z.string(),
  hostname: z.string(),
  challenge_ts: z.string(),
  success: z.boolean(),
});
const issueSchema = z.object({
  action: z.string().min(1),
  hostname: z.string().min(1),
  ageSeconds: z.number().min(-120).max(3600).default(0),
  success: z.boolean().default(true),
});
const spent = new Set<string>();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/issue" && request.method === "POST") {
      const data = issueSchema.safeParse(await request.json());
      if (!data.success) return Response.json({ error: "invalid fixture input" }, { status: 400 });
      const payload = Buffer.from(
        JSON.stringify({
          id: crypto.randomUUID(),
          action: data.data.action,
          hostname: data.data.hostname,
          challenge_ts: new Date(Date.now() - data.data.ageSeconds * 1000).toISOString(),
          success: data.data.success,
        }),
      ).toString("base64url");
      const signature = createHmac("sha256", signingKey).update(payload).digest("base64url");
      return Response.json({ token: `${payload}.${signature}` });
    }
    if (path === "/siteverify" && request.method === "POST") {
      const body = new URLSearchParams(await request.text());
      if (body.get("secret") !== "captcha-fixture-secret") {
        return Response.json({ success: false, "error-codes": ["invalid-input-secret"] });
      }
      const [payload, signature, extra] = (body.get("response") ?? "").split(".");
      if (!payload || !signature || extra)
        return Response.json({ success: false, "error-codes": ["invalid-input-response"] });
      const expected = createHmac("sha256", signingKey).update(payload).digest();
      const actual = Buffer.from(signature, "base64url");
      if (actual.byteLength !== expected.byteLength || !timingSafeEqual(expected, actual)) {
        return Response.json({ success: false, "error-codes": ["invalid-input-response"] });
      }
      let parsed: z.infer<typeof payloadSchema>;
      try {
        parsed = payloadSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString()));
      } catch {
        return Response.json({ success: false, "error-codes": ["invalid-input-response"] });
      }
      if (spent.has(parsed.id))
        return Response.json({ success: false, "error-codes": ["timeout-or-duplicate"] });
      spent.add(parsed.id);
      // Deliberately return signed stale/wrong-host/wrong-action successes too, so
      // the actual generated boundary, not just this fixture, must enforce bindings.
      return Response.json(parsed);
    }
    return new Response("Not found", { status: 404 });
  },
});
console.log(`Captcha protocol fixture listening on ${server.url}`);
