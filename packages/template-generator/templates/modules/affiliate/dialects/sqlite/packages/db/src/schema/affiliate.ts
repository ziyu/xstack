import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

export const affiliateProfile = sqliteTable("affiliate_profile", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
});

export const affiliateReferral = sqliteTable("affiliate_referral", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  referrerId: text("referrer_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [index("affiliate_referral_referrer_idx").on(table.referrerId)]);

// Cross-feature order IDs deliberately have no foreign key.
export const affiliateCommission = sqliteTable("affiliate_commission", {
  orderId: text("order_id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  referrerId: text("referrer_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  credits: integer("credits").notNull(),
  status: text("status", { enum: ["pending", "granted"] }).notNull().default("pending"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  grantedAt: integer("granted_at", { mode: "timestamp_ms" }),
}, (table) => [index("affiliate_commission_referrer_idx").on(table.referrerId, table.createdAt)]);
