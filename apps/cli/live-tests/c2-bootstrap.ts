import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

// Run only against the owned SQLite C2 fixture after migration. Uses generated services, not mocks.
const project = resolve(process.argv[2] ?? "");
assert.ok(project.startsWith(resolve(import.meta.dir, "../.smoke") + sep));
// Module specifiers depend on the caller-selected generated project, not this repository.
const { createAuth } = await import(pathToFileURL(`${project}/packages/auth/src/index.ts`).href);
const { createDb } = await import(pathToFileURL(`${project}/packages/db/src/index.ts`).href);
const { createEventBus } = await import(
  pathToFileURL(`${project}/packages/events/src/index.ts`).href
);
const db = createDb({ DATABASE_URL: `file:${project}/local.db` });
const sqlite = new Database(`${project}/local.db`, { create: false, readwrite: true });
const events = createEventBus();
let verification: string | undefined;
events.on("auth.verification_requested", (event: { url: string }) => {
  verification = event.url;
});
const origin = "http://localhost:4392";
const email = `bootstrap-${crypto.randomUUID()}@example.test`;
const auth = createAuth(
  {
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: "c2-bootstrap-local-secret-12345678901234567890",
    ADMIN_EMAILS: email,
  },
  db,
  events,
);
async function call(
  path: string,
  body?: { name: string; email: string; password: string },
  cookie = "",
) {
  if (sqlite.query("SELECT name FROM sqlite_master WHERE name = 'rate_limit'").get())
    sqlite.exec("DELETE FROM rate_limit");
  return auth.handler(
    new Request(`${origin}/api/auth/${path}`, {
      method: body ? "POST" : "GET",
      headers: { origin, cookie, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
}
try {
  // Captcha applies to signup even for server API calls; this probe deliberately uses the
  // before-hook-free runtime only when captcha was not selected in the generated fixture.
  const result = await call("sign-up/email", {
    name: "Bootstrap",
    email,
    password: "Bootstrap-Password-123!",
  });
  assert.equal(result.status, 200, await result.clone().text());
  const user = z
    .object({ user: z.object({ id: z.string(), role: z.string(), emailVerified: z.boolean() }) })
    .parse(await result.json()).user;
  assert.equal(user.role, "user");
  assert.equal(user.emailVerified, false);
  assert.ok(verification, "Real verification event emitted");
  const link = new URL(verification);
  const verified = await call(`verify-email${link.search}`);
  assert.ok(verified.status === 200 || verified.status === 302);
  const row = z
    .object({ role: z.string(), email_verified: z.number() })
    .parse(sqlite.query("SELECT role, email_verified FROM user WHERE id = ?").get(user.id));
  assert.deepEqual(row, { role: "admin", email_verified: 1 });
  sqlite.query("UPDATE user SET role = ? WHERE id = ?").run("user", user.id);
  await call(`verify-email${link.search}`);
  const demoted = z
    .object({ role: z.string() })
    .parse(sqlite.query("SELECT role FROM user WHERE id = ?").get(user.id));
  assert.equal(demoted.role, "user", "Replayed verification cannot undo a demotion");
  console.log(
    "PASS generated bootstrap: unverified denied, ownership proof promotes, verification replay cannot repromote",
  );
} finally {
  sqlite.close();
  db.$client.close();
}
