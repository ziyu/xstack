import { z } from "zod";
export const orderSchema = z.object({
  id: z.string(),
  planId: z.string(),
  provider: z.string(),
  status: z.string(),
  amount: z.number(),
  currency: z.string(),
  createdAt: z.string(),
  paidAt: z.string().nullable(),
});
export const billingSchema = z.object({
  orders: z.array(orderSchema),
  subscription: z
    .object({
      planId: z.string(),
      status: z.string(),
      customerRef: z.string().nullish(),
      currentPeriodEnd: z.string().nullish(),
      cancelAtPeriodEnd: z.boolean(),
    })
    .nullish(),
});
export const pricingSchema = z.object({
  plans: z.array(
    z.object({
      id: z.string(),
      amount: z.number(),
      currency: z.string(),
      credits: z.number().optional(),
      mode: z.string(),
      interval: z.string().optional(),
      providers: z.array(z.string()),
    }),
  ),
});
export function formatMoney(amount: number, currency: string, locale: string) {
  const format = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
  });
  return format.format(amount / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2));
}
