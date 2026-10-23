import Stripe from "stripe";

import type { PaymentProvider, ProviderOptions, SubscriptionStatus, WebhookEvent } from "../types";

export type ProviderConfig = {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
};

function ref(value: string | { id: string } | null | undefined): string | undefined {
  return value instanceof Object ? value.id : (value ?? undefined);
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
  let client: Stripe | undefined;
  const stripe = () => {
    if (!env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not set; see docs/modules/payment.md");
    }
    client ??= new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
    return client;
  };

  return {
    id: "stripe",
    configured: Boolean(env.STRIPE_SECRET_KEY),

    async createCheckout({ orderId, plan, customer, successUrl, cancelUrl }) {
      const metadata = { orderId, userId: customer.id, planId: plan.id };
      const priceId = plan.providerRefs?.stripe;
      const recurring =
        plan.mode === "subscription" ? { interval: plan.interval ?? "month" } : undefined;

      const session = await stripe().checkout.sessions.create({
        mode: plan.mode,
        client_reference_id: orderId,
        customer: customer.providerRef,
        customer_email: customer.providerRef ? undefined : customer.email,
        line_items: [
          priceId
            ? { price: priceId, quantity: 1 }
            : {
                quantity: 1,
                price_data: {
                  currency: plan.currency,
                  unit_amount: plan.amount,
                  product_data: { name: plan.id },
                  recurring,
                },
              },
        ],
        metadata,
        subscription_data: plan.mode === "subscription" ? { metadata } : undefined,
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      if (!session.url) throw new Error("Stripe did not return a checkout URL");
      return { url: session.url, providerRef: session.id };
    },

    async parseWebhook(request): Promise<WebhookEvent[]> {
      if (!env.STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
      const signature = request.headers.get("stripe-signature");
      if (!signature) throw new Error("Missing stripe-signature header");
      const event = await stripe().webhooks.constructEventAsync(
        await request.text(),
        signature,
        env.STRIPE_WEBHOOK_SECRET,
        undefined,
        Stripe.createSubtleCryptoProvider(),
      );

      switch (event.type) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded": {
          const session = event.data.object;
          const orderId = session.client_reference_id ?? session.metadata?.orderId;
          if (!orderId || session.payment_status === "unpaid") return [];
          return [
            {
              type: "checkout.completed",
              orderId,
              providerRef: session.id,
              customerRef: ref(session.customer),
              subscriptionRef: ref(session.subscription),
            },
          ];
        }
        case "invoice.paid": {
          const invoice = event.data.object;
          const subscriptionRef = ref(invoice.parent?.subscription_details?.subscription);
          if (invoice.billing_reason !== "subscription_cycle" || !subscriptionRef || !invoice.id) {
            return [];
          }
          return [
            {
              type: "subscription.renewed",
              subscriptionRef,
              invoiceRef: invoice.id,
              amount: invoice.amount_paid,
              currency: invoice.currency,
            },
          ];
        }
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          const subscription = event.data.object;
          const periodEnd = subscription.items.data[0]?.current_period_end;
          return [
            {
              type: "subscription.updated",
              subscriptionRef: subscription.id,
              userId: subscription.metadata.userId,
              planId: subscription.metadata.planId,
              customerRef: ref(subscription.customer),
              status: STATUSES.get(subscription.status) ?? "incomplete",
              currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : undefined,
              cancelAtPeriodEnd: subscription.cancel_at_period_end,
            },
          ];
        }
        default:
          return [];
      }
    },

    async createPortalUrl(customerRef, returnUrl) {
      const session = await stripe().billingPortal.sessions.create({
        customer: customerRef,
        return_url: returnUrl,
      });
      return session.url;
    },
  };
}
