import { createPolar, webhooks } from "@polar-sh/sdk/2026-10";

import type { PaymentProvider, ProviderOptions, SubscriptionStatus, WebhookEvent } from "../types";

export type ProviderConfig = {
  POLAR_ACCESS_TOKEN?: string;
  POLAR_WEBHOOK_SECRET?: string;
  POLAR_SERVER?: "sandbox" | "production";
};

type Metadata = Record<string, string | number | boolean>;

function text(metadata: Metadata, key: string): string | undefined {
  const value = metadata[key];
  return value === undefined ? undefined : String(value);
}

const STATUSES = new Map<string, SubscriptionStatus>([
  ["active", "active"],
  ["trialing", "trialing"],
  ["past_due", "past_due"],
  ["canceled", "canceled"],
  ["unpaid", "unpaid"],
  ["incomplete_expired", "canceled"],
  ["paused", "unpaid"],
]);

export function createProvider({ env }: ProviderOptions<ProviderConfig>): PaymentProvider {
  let client: ReturnType<typeof createPolar> | undefined;
  const polar = () => {
    if (!env.POLAR_ACCESS_TOKEN) {
      throw new Error("POLAR_ACCESS_TOKEN is not set; see docs/modules/payment.md");
    }
    client ??= createPolar({
      accessToken: env.POLAR_ACCESS_TOKEN,
      environment: env.POLAR_SERVER ?? "sandbox",
    });
    return client;
  };

  return {
    id: "polar",
    configured: Boolean(env.POLAR_ACCESS_TOKEN),

    async createCheckout({ orderId, plan, customer, successUrl, cancelUrl }) {
      const productId = plan.providerRefs?.polar;
      if (!productId) {
        throw new Error(
          `Plan "${plan.id}" has no Polar product; set providerRefs.polar in plans.ts`,
        );
      }
      const checkout = await polar().checkouts.create({
        products: [productId],
        metadata: { orderId, userId: customer.id, planId: plan.id },
        customer_id: customer.providerRef,
        external_customer_id: customer.providerRef ? undefined : customer.id,
        customer_email: customer.email,
        success_url: successUrl,
        return_url: cancelUrl,
      });
      return { url: checkout.url, providerRef: checkout.id };
    },

    async parseWebhook(request): Promise<WebhookEvent[]> {
      if (!env.POLAR_WEBHOOK_SECRET) throw new Error("POLAR_WEBHOOK_SECRET is not set");
      const headers = Object.fromEntries(
        ["webhook-id", "webhook-timestamp", "webhook-signature"].map((name) => [
          name,
          request.headers.get(name) ?? "",
        ]),
      );
      let event: webhooks.WebhookPayload;
      try {
        event = await webhooks.validateEvent(
          await request.text(),
          headers,
          env.POLAR_WEBHOOK_SECRET,
        );
      } catch (error) {
        if (error instanceof webhooks.PolarWebhookUnknownTypeError) return [];
        throw error;
      }

      switch (event.type) {
        case "order.paid": {
          const order = event.data;
          if (order.billing_reason === "subscription_cycle") {
            if (!order.subscription_id) return [];
            return [
              {
                type: "subscription.renewed",
                subscriptionRef: order.subscription_id,
                invoiceRef: order.id,
                amount: order.total_amount,
                currency: order.currency,
              },
            ];
          }
          const orderId = text(order.metadata, "orderId");
          if (!orderId || !["purchase", "subscription_create"].includes(order.billing_reason)) {
            return [];
          }
          return [
            {
              type: "checkout.completed",
              orderId,
              providerRef: order.checkout_id ?? order.id,
              customerRef: order.customer_id,
              subscriptionRef: order.subscription_id ?? undefined,
            },
          ];
        }
        case "subscription.created":
        case "subscription.updated": {
          const subscription = event.data;
          return [
            {
              type: "subscription.updated",
              subscriptionRef: subscription.id,
              userId:
                text(subscription.metadata, "userId") ??
                subscription.customer.external_id ??
                undefined,
              planId: text(subscription.metadata, "planId"),
              customerRef: subscription.customer_id,
              status: STATUSES.get(subscription.status) ?? "incomplete",
              currentPeriodEnd: new Date(subscription.current_period_end),
              cancelAtPeriodEnd: subscription.cancel_at_period_end,
            },
          ];
        }
        default:
          return [];
      }
    },

    async createPortalUrl(customerRef, returnUrl) {
      const session = await polar().customerSessions.create({
        customer_id: customerRef,
        return_url: returnUrl,
      });
      return session.customer_portal_url;
    },
  };
}
