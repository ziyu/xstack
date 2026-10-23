import { Database as SQLite } from "bun:sqlite";
import assert from "node:assert/strict";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

// Protocol fixture, NOT a live cloud acceptance test. Runs the generated AI and
// credits services against the generated, migrated SQLite database. No API keys
// or paid provider traffic are used; every transport URL is intercepted below.
const project = resolve(process.argv[2] ?? "");
const filename = resolve(process.argv[3] ?? "");
if (
  !project.startsWith(resolve(import.meta.dir, "../.smoke") + sep) ||
  !filename.startsWith(project + sep)
)
  throw new Error("Use a disposable .smoke project and database within it");
const jobSchema = z.object({
  id: z.string(),
  status: z.string(),
  error: z.string().nullable(),
  text: z.string().nullable(),
  mediaUrl: z.string().nullable(),
  cost: z.number(),
});
type Job = z.infer<typeof jobSchema>;
type Input = {
  requestId: string;
  provider: string;
  kind: "chat" | "image" | "video";
  prompt: string;
};
type AI = {
  setBilling(value: {
    charge(id: string, amount: number, reference: string): Promise<void>;
    refund(id: string, reference: string): Promise<void>;
  }): void;
  generate(id: string, input: Input): Promise<Job>;
  poll(id: string, job: string): Promise<Job>;
  cancel(id: string, job: string): Promise<Job>;
  media(id: string, job: string): Promise<{ body: Uint8Array; contentType: string }>;
};
const load = (path: string) => import(pathToFileURL(resolve(project, path)).href);
const { createDb } = await load("packages/db/src/index.ts");
const { createEventBus } = await load("packages/events/src/index.ts");
const { createCredits } = await load("packages/credits/src/index.ts");
const { createAI } = await load("packages/ai/src/index.ts");
const sql = new SQLite(filename);
sql.exec("PRAGMA foreign_keys=ON");
const owner = crypto.randomUUID();
const other = crypto.randomUUID();
for (const id of [owner, other])
  sql
    .query(
      "INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?, ?, ?, 0, ?, ?)",
    )
    .run(id, "AI fixture", `${id}@example.test`, Date.now(), Date.now());
const db = createDb({ DATABASE_URL: `file:${filename}` });
const credits = createCredits(db, createEventBus());
const nativeFetch = globalThis.fetch;
const calls = new Map<string, number>();
const remotes = new Map<string, { prompt: string; cancelled: boolean }>();
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR2UAAAAASUVORK5CYII=";
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  assert.ok(
    ["api.openai.com", "api.deepseek.com", "generativelanguage.googleapis.com"].includes(
      url.hostname,
    ),
    `Unexpected network URL: ${url}`,
  );
  const path = url.pathname;
  if (path.includes("/interactions/") && !init?.body) {
    const id = path.split("/")[3]!;
    const remote = remotes.get(id)!;
    if (path.endsWith("/cancel")) {
      remote.cancelled = true;
      return Response.json({});
    }
    if (remote.cancelled) return Response.json({ id, status: "cancelled" });
    if (remote.prompt === "async-fail") return Response.json({ id, status: "failed" });
    if (remote.prompt === "cancel") return Response.json({ id, status: "in_progress" });
    return Response.json({
      id,
      status: "completed",
      steps: [
        {
          type: "model_output",
          content: [
            { type: "video", mime_type: "video/mp4", data: btoa("protocol fixture MP4 bytes") },
          ],
        },
      ],
    });
  }
  const body = z
    .object({
      prompt: z.string().optional(),
      input: z.string().optional(),
      messages: z.array(z.object({ content: z.string() })).optional(),
    })
    .parse(JSON.parse(String(init?.body)));
  const prompt = body.prompt ?? body.input ?? body.messages?.at(-1)?.content;
  if (prompt === undefined) throw new Error("Provider request must contain a prompt");
  calls.set(prompt, (calls.get(prompt) ?? 0) + 1);
  const pause = Promise.withResolvers<void>();
  setTimeout(pause.resolve, 20);
  await pause.promise;
  if (prompt === "reject")
    return Response.json({ error: { message: "fixture rejection" } }, { status: 400 });
  if (prompt === "ambiguous")
    throw new TypeError("Fixture transport disconnected after submission");
  if (path.endsWith("/images/generations")) return Response.json({ data: [{ b64_json: png }] });
  if (path.endsWith("/interactions")) {
    const id = crypto.randomUUID();
    remotes.set(id, { prompt, cancelled: false });
    return Response.json({ id, status: "in_progress" });
  }
  assert.ok(path.endsWith("/chat/completions"));
  return Response.json({ choices: [{ message: { content: `Answer: ${prompt}` } }] });
}) as typeof fetch;
async function concurrent<T>(operations: Promise<T>[]): Promise<T[]> {
  const outcomes = await Promise.allSettled(operations);
  return outcomes.map((outcome) => {
    if (outcome.status === "rejected") throw outcome.reason;
    return outcome.value;
  });
}
let primaryFailure: unknown;
try {
  const ai: AI = createAI({
    db,
    env: {
      OPENAI_API_KEY: "protocol-fixture",
      GEMINI_API_KEY: "protocol-fixture",
      AI_COMPATIBLE_API_KEY: "protocol-fixture",
    },
  });
  ai.setBilling({
    charge: async (id, amount, reference) => {
      await credits.consume(id, amount, { referenceId: reference });
    },
    refund: async (id, reference) => {
      await credits.refund(id, reference);
    },
  });
  await credits.grant(owner, 1000, { type: "grant", referenceId: `fixture:${owner}` });
  const input = (prompt: string, kind: Input["kind"] = "chat", provider = "openai"): Input => ({
    requestId: crypto.randomUUID(),
    provider,
    kind,
    prompt,
  });
  const replay = input("parallel");
  const parallel = await concurrent(Array.from({ length: 8 }, () => ai.generate(owner, replay)));
  assert.equal(new Set(parallel.map((job) => job.id)).size, 1);
  assert.equal(calls.get("parallel"), 1);
  const first = jobSchema.parse(await ai.generate(owner, replay));
  assert.equal(first.status, "completed");
  assert.equal(await credits.getBalance(owner), 1000 - first.cost);
  await assert.rejects(ai.generate(owner, { ...replay, prompt: "changed" }));
  await assert.rejects(ai.poll(other, first.id));
  await assert.rejects(
    credits.grant(other, 1000, { type: "grant", referenceId: `fixture:${owner}` }),
  );
  const before = await credits.getBalance(owner);
  const rejected = await ai.generate(owner, input("reject"));
  assert.equal(rejected.status, "failed");
  await concurrent(Array.from({ length: 6 }, () => ai.poll(owner, rejected.id)));
  assert.equal(await credits.getBalance(owner), before);
  assert.equal(calls.get("reject"), 1);
  const poor = await ai.generate(other, input("poor"));
  assert.equal(poor.status, "failed");
  assert.equal(calls.has("poor"), false);
  await assert.rejects(ai.generate(owner, input("unsupported", "video", "openai")));
  assert.equal(calls.has("unsupported"), false);
  const picture = await ai.generate(owner, input("picture", "image"));
  assert.equal(picture.status, "completed");
  assert.deepEqual(
    (await ai.media(owner, picture.id)).body,
    Uint8Array.from(atob(png), (char) => char.charCodeAt(0)),
  );
  await assert.rejects(ai.media(other, picture.id));
  const video = await ai.generate(owner, input("video", "video", "google"));
  assert.equal(video.status, "running");
  assert.equal((await ai.poll(owner, video.id)).status, "completed");
  assert.equal((await ai.media(owner, video.id)).contentType, "video/mp4");
  const beforeFailedVideo = await credits.getBalance(owner);
  const failedVideo = await ai.generate(owner, input("async-fail", "video", "google"));
  await concurrent(Array.from({ length: 5 }, () => ai.poll(owner, failedVideo.id)));
  await ai.poll(owner, failedVideo.id);
  assert.equal(await credits.getBalance(owner), beforeFailedVideo);
  const beforeCancel = await credits.getBalance(owner);
  const cancelled = await ai.generate(owner, input("cancel", "video", "google"));
  assert.equal((await ai.cancel(owner, cancelled.id)).status, "cancelled");
  assert.equal(await credits.getBalance(owner), beforeCancel);
  const unknownInput = input("ambiguous");
  assert.equal((await ai.generate(owner, unknownInput)).status, "unknown");
  assert.equal((await ai.generate(owner, unknownInput)).status, "unknown");
  assert.equal(calls.get("ambiguous"), 1);
  const compatible = await ai.generate(owner, input("DeepSeek", "chat", "openai-compatible"));
  assert.equal(compatible.text, "Answer: DeepSeek");
  const orphanInput = input("orphaned-submission");
  const orphanId = crypto.randomUUID();
  sql
    .query(
      "INSERT INTO ai_job (id,user_id,request_id,provider,kind,model,prompt,cost,status,lease_token,lease_until,created_at,updated_at) VALUES (?, ?, ?, 'openai', 'chat', 'gpt-4.1-mini', ?, 1, 'starting', ?, 0, ?, ?)",
    )
    .run(
      orphanId,
      owner,
      orphanInput.requestId,
      orphanInput.prompt,
      crypto.randomUUID(),
      Date.now(),
      Date.now(),
    );
  assert.equal((await ai.poll(owner, orphanId)).status, "unknown");
  assert.equal((await ai.generate(owner, orphanInput)).status, "unknown");
  assert.equal(calls.has("orphaned-submission"), false);
  console.log(
    "PASS generated AI + SQLite + credits protocol fixture: concurrent replay, conflict/ownership, insufficient balance, definite and async failure refunds, cancellation, image/video bytes, unknown outcome safety, DeepSeek chat. Not cloud acceptance.",
  );
} catch (error) {
  primaryFailure = error;
} finally {
  globalThis.fetch = nativeFetch;
  try {
    sql.query("DELETE FROM user WHERE id IN (?, ?)").run(owner, other);
  } catch (cleanupError) {
    if (!primaryFailure) primaryFailure = cleanupError;
    else console.error("AI fixture cleanup also failed:", cleanupError);
  } finally {
    sql.close();
  }
}
if (primaryFailure) throw primaryFailure;
