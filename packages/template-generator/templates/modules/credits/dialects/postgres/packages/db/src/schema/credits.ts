import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const creditTransactionTypes = [
  "purchase",
  "subscription",
  "signup",
  "grant",
  "consume",
  "refund",
  "adjust",
  "affiliate",
] as const;

export const creditBalance = pgTable("credit_balance", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  balance: integer("balance").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const creditTransaction = pgTable(
  "credit_transaction",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Positive for grants, negative for consumption. */
    amount: integer("amount").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    type: text("type", { enum: creditTransactionTypes }).notNull(),
    reason: text("reason"),
    /** Idempotency key, e.g. `order:<id>`; a reference is applied at most once. */
    referenceId: text("reference_id").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("credit_transaction_user_idx").on(table.userId, table.createdAt)],
);
