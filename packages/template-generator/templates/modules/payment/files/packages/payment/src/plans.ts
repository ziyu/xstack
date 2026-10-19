import type { Plan } from "./types";

/**
 * Your pricing. Names and descriptions are translated in
 * `packages/i18n/src/messages/<locale>/payment.ts` under `plans.<id>`.
 */
export const plans = [
  {
    id: "starter",
    mode: "payment",
    amount: 900,
    currency: "usd",
    credits: 500,
  },
  {
    id: "pro",
    mode: "subscription",
    interval: "month",
    amount: 1900,
    currency: "usd",
    credits: 3000,
    highlighted: true,
  },
] as const satisfies readonly Plan[];

export type AppPlan = (typeof plans)[number];

export type PlanId = AppPlan["id"];

export function getPlan(id: string): AppPlan | undefined {
  return plans.find((plan) => plan.id === id);
}
