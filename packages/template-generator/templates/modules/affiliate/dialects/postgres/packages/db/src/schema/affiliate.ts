import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const affiliateProfile = pgTable("affiliate_profile", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
});

export const affiliateReferral = pgTable("affiliate_referral", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  referrerId: text("referrer_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [index("affiliate_referral_referrer_idx").on(table.referrerId)]);

// Cross-feature order IDs deliberately have no foreign key.
export const affiliateCommission = pgTable("affiliate_commission", {
  orderId: text("order_id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  referrerId: text("referrer_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  credits: integer("credits").notNull(),
  status: text("status", { enum: ["pending", "granted"] }).notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  grantedAt: timestamp("granted_at"),
}, (table) => [index("affiliate_commission_referrer_idx").on(table.referrerId, table.createdAt)]);
