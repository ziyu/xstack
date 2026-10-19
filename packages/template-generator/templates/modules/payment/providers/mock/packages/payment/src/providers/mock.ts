import type { PaymentProvider, ProviderOptions, WebhookEvent } from "../types";

export type ProviderConfig = {
  NODE_ENV: string;
};

const PERIOD_DAYS = { month: 30, year: 365 } as const;

/**
 * Simulates checkout locally: the "checkout page" is `/api/payment/mock`, which posts
 * back a fake webhook. Refuses to run in production.
 */
export function createProvider({ env, baseUrl }: ProviderOptions<ProviderConfig>): PaymentProvider {
  const guard = () => {
    if (env.NODE_ENV === "production") {
      throw new Error("The mock payment provider is disabled in production");
    }
  };

  return {
    id: "mock",
    configured: env.NODE_ENV !== "production",

    async createCheckout({ orderId, plan, customer, successUrl, cancelUrl }) {
      guard();
      const url = new URL("/api/payment/mock", baseUrl);
      url.search = new URLSearchParams({
        orderId,
        userId: customer.id,
        planId: plan.id,
        interval: plan.mode === "subscription" ? (plan.interval ?? "month") : "",
        success: successUrl,
        cancel: cancelUrl,
      }).toString();
      return { url: url.toString(), providerRef: `mock_${orderId}` };
    },

    async parseWebhook(request) {
      guard();
      const form = new URLSearchParams(await request.text());
      const orderId = form.get("orderId");
      if (!orderId) return [];
      const interval = form.get("interval");
      const subscriptionRef = interval ? `mock_sub_${orderId}` : undefined;

      const events: WebhookEvent[] = [];
      if (subscriptionRef && (interval === "month" || interval === "year")) {
        events.push({
          type: "subscription.updated",
          subscriptionRef,
          userId: form.get("userId") ?? undefined,
          planId: form.get("planId") ?? undefined,
          status: "active",
          currentPeriodEnd: new Date(Date.now() + PERIOD_DAYS[interval] * 86_400_000),
          cancelAtPeriodEnd: false,
        });
      }
      events.push({
        type: "checkout.completed",
        orderId,
        providerRef: `mock_${orderId}`,
        subscriptionRef,
      });
      return events;
    },
  };
}
