import assert from "node:assert/strict";
import { resolve, sep } from "node:path";

import { z } from "zod";

// Run against a disposable generated app backed by a local SDK transport fixture or test bucket.
// This creates and deletes files; never use production credentials.
const project = resolve(process.argv[2] ?? "");
const origin = process.argv[3] ?? "";
if (!project.startsWith(resolve(import.meta.dir, "../.smoke") + sep)) {
  throw new Error("Expected a generated fixture inside apps/cli/.smoke");
}
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) {
  throw new Error("Expected a loopback app origin");
}
const responseSchema = z.object({ id: z.string() });
async function signup() {
  const response = await fetch(`${origin}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({
      name: "Storage fixture",
      email: `storage-${crypto.randomUUID()}@example.test`,
      password: "Local-storage-fixture-2026!",
    }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}
function form(name = "report.txt", data = "private fixture bytes") {
  const body = new FormData();
  body.set("file", new File([data], name, { type: "text/html" }));
  return body;
}
const owner = await signup();
const other = await signup();
const endpoint = `${origin}/api/storage`;
const unauthenticated = await fetch(endpoint, {
  method: "POST",
  headers: { origin },
  body: form(),
});
assert.equal(unauthenticated.status, 401);
const crossOrigin = await fetch(endpoint, {
  method: "POST",
  headers: { origin: "https://attacker.example", cookie: owner },
  body: form(),
});
assert.equal(crossOrigin.status, 403);
const oversized = await fetch(endpoint, {
  method: "POST",
  headers: { origin, cookie: owner },
  body: form("large.bin", "x".repeat(4 * 1024 * 1024 + 1)),
});
assert.equal(oversized.status, 413);
const empty = await fetch(endpoint, {
  method: "POST",
  headers: { origin, cookie: owner },
  body: form("empty.txt", ""),
});
assert.equal(empty.status, 400);
const duplicate = form();
duplicate.append("file", new File(["second"], "second.txt"));
assert.equal(
  (await fetch(endpoint, { method: "POST", headers: { origin, cookie: owner }, body: duplicate }))
    .status,
  400,
);
const uploaded = await fetch(endpoint, {
  method: "POST",
  headers: { origin, cookie: owner },
  body: form(),
});
assert.equal(uploaded.status, 201, await uploaded.clone().text());
const { id } = responseSchema.parse(await uploaded.json());
try {
  const foreignDownload = await fetch(`${endpoint}/${id}`, {
    headers: { cookie: other },
    redirect: "manual",
  });
  assert.equal(foreignDownload.status, 404);
  const foreignDelete = await fetch(`${endpoint}/${id}`, {
    method: "DELETE",
    headers: { origin, cookie: other },
  });
  assert.equal(foreignDelete.status, 404);
  const download = await fetch(`${endpoint}/${id}`, {
    headers: { cookie: owner },
    redirect: "manual",
  });
  if (process.argv[4] === "r2-binding") {
    assert.equal(download.status, 200, await download.clone().text());
    assert.equal(await download.text(), "private fixture bytes");
    assert.match(download.headers.get("content-disposition") ?? "", /^attachment;/);
    assert.equal(download.headers.get("content-type"), "application/octet-stream");
    assert.equal(download.headers.get("cache-control"), "private, no-store");
  } else {
    assert.equal(download.status, 307);
    const location = new URL(download.headers.get("location")!);
    assert.equal(location.protocol, "https:");
    assert.match(location.searchParams.get("response-content-disposition") ?? "", /^attachment;/);
    assert.equal(location.searchParams.get("response-content-type"), "application/octet-stream");
  }
  const hostileDelete = await fetch(`${endpoint}/${id}`, {
    method: "DELETE",
    headers: { origin: "https://attacker.example", cookie: owner },
  });
  assert.equal(hostileDelete.status, 403);
  const deleted = await fetch(`${endpoint}/${id}`, {
    method: "DELETE",
    headers: { origin, cookie: owner },
  });
  assert.equal(deleted.status, 204);
  const missing = await fetch(`${endpoint}/${id}`, {
    headers: { cookie: owner },
    redirect: "manual",
  });
  assert.equal(missing.status, 404);
  console.log(
    "PASS storage HTTP: authenticated upload, 4MiB/empty limits, CSRF rejection, cross-user isolation, signed download, deletion. Provider transport determines whether cloud access was exercised.",
  );
} finally {
  await fetch(`${endpoint}/${id}`, { method: "DELETE", headers: { origin, cookie: owner } });
}
