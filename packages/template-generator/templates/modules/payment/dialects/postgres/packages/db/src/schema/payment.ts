import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export const paymentOrder = pgTable(
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
    status: text("status", { enum: ["pending", "paid", "failed", "refunded"] })
      .notNull()
      .default("pending"),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (table) => [
    index("payment_order_user_idx").on(table.userId),
    uniqueIndex("payment_order_provider_ref_idx").on(table.provider, table.providerRef),
  ],
);

export const paymentSubscription = pgTable(
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
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("payment_subscription_user_idx").on(table.userId),
    uniqueIndex("payment_subscription_provider_ref_idx").on(table.provider, table.providerRef),
  ],
);
