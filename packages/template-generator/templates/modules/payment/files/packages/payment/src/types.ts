export type PlanInterval = "month" | "year";

export type Plan = {
  id: string;
  mode: "payment" | "subscription";
  /** Price in the currency's minor unit (cents). */
  amount: number;
  currency: string;
  interval?: PlanInterval;
  /** Credits granted on every successful payment when the credits module is installed. */
  credits?: number;
  /** Provider price identifiers such as a Stripe price ID; inline prices are used when absent. */
  providerRefs?: Record<string, string>;
  highlighted?: boolean;
};

export type OrderStatus = "pending" | "paid" | "failed" | "refunded";

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "unpaid";

export type CheckoutRequest = {
  orderId: string;
  plan: Plan;
  customer: { id: string; email: string; providerRef?: string };
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutSession = { url: string; providerRef: string; qrCodeUrl?: string };

/** Provider webhooks normalized into the events the payment service understands. */
export type WebhookEvent =
  | {
      type: "checkout.completed";
      orderId: string;
      providerRef: string;
      amount?: number;
      currency?: string;
      customerRef?: string;
      subscriptionRef?: string;
    }
  | {
      type: "subscription.renewed";
      subscriptionRef: string;
      invoiceRef: string;
      amount: number;
      currency: string;
    }
  | {
      type: "subscription.updated";
      subscriptionRef: string;
      userId?: string;
      planId?: string;
      customerRef?: string;
      status: SubscriptionStatus;
      currentPeriodEnd?: Date;
      cancelAtPeriodEnd: boolean;
    };

/** What `providers/index.ts` passes to every provider's `createProvider`. */
export type ProviderOptions<Config> = { env: Config; baseUrl: string };

export interface PaymentProvider {
  readonly id: string;
  /** False when credentials are missing; checkout then defaults to the next configured provider. */
  readonly configured: boolean;
  supportsPlan?(plan: Plan): boolean;
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  /** Verifies the request signature and returns the events it carries (possibly none). */
  parseWebhook(request: Request): Promise<WebhookEvent[]>;
  createPortalUrl?(customerRef: string, returnUrl: string): Promise<string>;
}
