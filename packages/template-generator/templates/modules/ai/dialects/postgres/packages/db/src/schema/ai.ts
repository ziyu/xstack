import { bigint, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const aiJob = pgTable("ai_job", {
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
  leaseUntil: bigint("lease_until", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("ai_job_request_idx").on(table.userId, table.requestId), index("ai_job_user_idx").on(table.userId, table.createdAt)]);

export const aiMediaChunk = pgTable("ai_media_chunk", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => aiJob.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  data: text("data").notNull(),
}, (table) => [uniqueIndex("ai_media_chunk_position_idx").on(table.jobId, table.position)]);
