import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth";

export const aiJob = sqliteTable("ai_job", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  requestId: text("request_id").notNull(),
  provider: text("provider").notNull(),
  kind: text("kind", { enum: ["chat", "image", "video"] }).notNull(),
  model: text("model").notNull(),
  prompt: text("prompt").notNull(),
  parentId: text("parent_id"),
  cost: integer("cost").notNull(),
  status: text("status", { enum: ["queued", "starting", "running", "saving", "unknown", "completed", "failed", "cancelled"] }).notNull().default("queued"),
  remoteId: text("remote_id"),
  resultText: text("result_text"),
  contentType: text("content_type"),
  fileId: text("file_id"),
  errorCode: text("error_code"),
  leaseToken: text("lease_token"),
  leaseUntil: integer("lease_until").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [uniqueIndex("ai_job_request_idx").on(table.userId, table.requestId), index("ai_job_user_idx").on(table.userId, table.createdAt)]);

// Keep each row below D1's per-row limit; media remains ownership-gated by ai_job.
export const aiMediaChunk = sqliteTable("ai_media_chunk", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => aiJob.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  data: text("data").notNull(),
}, (table) => [uniqueIndex("ai_media_chunk_position_idx").on(table.jobId, table.position)]);
