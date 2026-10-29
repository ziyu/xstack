import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Explicit development fixture seeding through the actual generated ledger service.
const project = await realpath(path.resolve(process.argv[2] ?? ""));
const smoke = await realpath(path.resolve(import.meta.dir, "../.smoke"));
assert.ok(project.startsWith(smoke + path.sep));
const userId = process.argv[3];
assert.ok(userId && process.env.DATABASE_URL);
const load = (file: string) => import(pathToFileURL(path.join(project, file)).href);
const { createDb } = await load("packages/db/src/index.ts");
const { createEventBus } = await load("packages/events/src/index.ts");
const { createCredits } = await load("packages/credits/src/index.ts");
const credits = createCredits(
  createDb({ DATABASE_URL: process.env.DATABASE_URL }),
  createEventBus(),
);
await credits.grant(userId, 1000, { type: "grant", referenceId: `c4-fixture:${userId}` });
assert.ok((await credits.getBalance(userId)) >= 1000);
console.log("C4 local account: real generated credit ledger grant completed");
// Generated database drivers expose different close APIs; this one-shot process owns its pool.
process.exit(0);
