import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

export const paymentOrder = sqliteTable(
  "payment_order",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    planId: text("plan_id").notNull(),
    provider: text("provider").notNull(),
    /** Checkout session or invoice ID at the provider. */
    providerRef: text("provider_ref"),
    qrCodeUrl: text("qr_code_url"),
    status: text("status", { enum: ["pending", "paid", "failed", "refunded"] })
      .notNull()
      .default("pending"),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
    paidAt: timestamp("paid_at"),
  },
  (table) => [
    index("payment_order_user_idx").on(table.userId),
    uniqueIndex("payment_order_provider_ref_idx").on(table.provider, table.providerRef),
  ],
);

export const paymentSubscription = sqliteTable(
  "payment_subscription",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    planId: text("plan_id").notNull(),
    provider: text("provider").notNull(),
    providerRef: text("provider_ref").notNull(),
    customerRef: text("customer_ref"),
    status: text("status", {
      enum: ["active", "trialing", "past_due", "canceled", "incomplete", "unpaid"],
    }).notNull(),
    currentPeriodEnd: timestamp("current_period_end"),
    cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: timestamp("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("payment_subscription_user_idx").on(table.userId),
    uniqueIndex("payment_subscription_provider_ref_idx").on(table.provider, table.providerRef),
  ],
);
