import { createPrivateKey, createPublicKey } from "node:crypto";

import { AlipaySdk } from "alipay-sdk";

import type { PaymentProvider, Plan, ProviderOptions, WebhookEvent } from "../types";

export type ProviderConfig = {
  ALIPAY_APP_ID?: string;
  ALIPAY_PRIVATE_KEY?: string;
  ALIPAY_PUBLIC_KEY?: string;
  ALIPAY_SELLER_ID?: string;
  ALIPAY_SANDBOX?: boolean;
};

const REQUIRED = [
  "ALIPAY_APP_ID",
  "ALIPAY_PRIVATE_KEY",
  "ALIPAY_PUBLIC_KEY",
  "ALIPAY_SELLER_ID",
] as const;
const ORDER_ID = /^[A-Za-z0-9_-]{1,64}$/;

function supportsPlan(plan: Plan): boolean {
  return (
    plan.mode === "payment" &&
    plan.currency.toLowerCase() === "cny" &&
    Number.isSafeInteger(plan.amount) &&
    plan.amount > 0
  );
}

function pem(value: string, label: "PRIVATE KEY" | "PUBLIC KEY"): string {
  const normalized = value.replace(/\\n/g, "\n").trim();
  if (normalized.startsWith("-----BEGIN ")) {
    if (
      !normalized.startsWith(`-----BEGIN ${label}-----`) ||
      !normalized.endsWith(`-----END ${label}-----`)
    ) {
      throw new Error(
        "Alipay requires a PKCS8 private key and a plain public key, not certificates",
      );
    }
    return normalized;
  }
  return `-----BEGIN ${label}-----\n${normalized}\n-----END ${label}-----`;
}

function amountInCents(value: string | undefined): number {
  // Parse decimal digits, never round a floating-point currency amount.
  const match = value?.match(/^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/);
  if (!match) throw new Error("Invalid Alipay total_amount");
  const cents = BigInt(match[1]!) * BigInt(100) + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (cents <= BigInt(0) || cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Alipay total_amount must be positive safe integer cents");
  }
  return Number(cents);
}

export function createProvider({ env, baseUrl }: ProviderOptions<ProviderConfig>): PaymentProvider {
  let client: AlipaySdk | undefined;
  function alipay(): AlipaySdk {
    if (client) return client;
    for (const name of REQUIRED) {
      if (!env[name]?.trim()) throw new Error(`${name} is not set; see docs/modules/payment.md`);
    }
    if (!/^[0-9]+$/.test(env.ALIPAY_APP_ID!) || !/^[0-9]+$/.test(env.ALIPAY_SELLER_ID!)) {
      throw new Error("Invalid Alipay app ID or seller ID");
    }
    if (
      env.ALIPAY_SANDBOX !== undefined &&
      env.ALIPAY_SANDBOX !== true &&
      env.ALIPAY_SANDBOX !== false
    ) {
      throw new Error("ALIPAY_SANDBOX must be a boolean");
    }
    const privateKey = pem(env.ALIPAY_PRIVATE_KEY!, "PRIVATE KEY");
    const publicKey = pem(env.ALIPAY_PUBLIC_KEY!, "PUBLIC KEY");
    if (
      createPrivateKey(privateKey).asymmetricKeyType !== "rsa" ||
      createPublicKey(publicKey).asymmetricKeyType !== "rsa"
    ) {
      throw new Error("Alipay requires RSA private and public keys");
    }
    client = new AlipaySdk({
      appId: env.ALIPAY_APP_ID!,
      privateKey,
      alipayPublicKey: publicKey,
      keyType: "PKCS8",
      signType: "RSA2",
      charset: "utf-8",
      gateway:
        env.ALIPAY_SANDBOX === true
          ? "https://openapi-sandbox.dl.alipaydev.com/gateway.do"
          : "https://openapi.alipay.com/gateway.do",
    });
    return client;
  }

  return {
    id: "alipay",
    configured: REQUIRED.every((name) => Boolean(env[name]?.trim())),
    supportsPlan,

    async createCheckout({ orderId, plan, successUrl }) {
      const sdk = alipay();
      if (!supportsPlan(plan))
        throw new Error("Alipay only supports positive one-time CNY payments");
      if (!ORDER_ID.test(orderId)) throw new Error("Invalid Alipay merchant order ID");
      const cents = BigInt(plan.amount);
      const url = sdk.pageExecute("alipay.trade.page.pay", "GET", {
        notifyUrl: new URL("/api/payment/webhook/alipay", baseUrl).toString(),
        // Browser returns are navigation only; only verified POST notifications grant purchases.
        returnUrl: successUrl,
        bizContent: {
          outTradeNo: orderId,
          productCode: "FAST_INSTANT_TRADE_PAY",
          totalAmount: `${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, "0")}`,
          subject: plan.id,
          sellerId: env.ALIPAY_SELLER_ID!,
        },
      });
      return { url, providerRef: orderId };
    },

    async parseWebhook(request): Promise<WebhookEvent[]> {
      const sdk = alipay();
      if (request.method !== "POST") throw new Error("Alipay notifications require POST");
      if (
        request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/x-www-form-urlencoded"
      ) {
        throw new Error("Alipay notifications require form-urlencoded content");
      }
      const fields: Record<string, string> = Object.create(null);
      for (const [key, value] of new URLSearchParams(await request.text())) {
        if (!key || Object.hasOwn(fields, key))
          throw new Error("Duplicate or empty Alipay notification field");
        fields[key] = value;
      }
      // URLSearchParams decodes exactly once. V2 does not decode '%' or '+' a second time.
      if (fields.sign_type !== "RSA2" || !sdk.checkNotifySignV2(fields)) {
        throw new Error("Invalid Alipay notification signature");
      }
      if (
        fields.app_id !== env.ALIPAY_APP_ID ||
        fields.seller_id !== env.ALIPAY_SELLER_ID ||
        fields.notify_type !== "trade_status_sync"
      ) {
        throw new Error("Invalid Alipay notification app, seller or notification type");
      }
      if (fields.trade_status !== "TRADE_SUCCESS" && fields.trade_status !== "TRADE_FINISHED") {
        return [];
      }
      const orderId = fields.out_trade_no;
      const transactionId = fields.trade_no;
      if (
        !orderId ||
        !ORDER_ID.test(orderId) ||
        !transactionId ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(transactionId)
      ) {
        throw new Error("Invalid Alipay order or transaction reference");
      }
      return [
        {
          type: "checkout.completed",
          orderId,
          providerRef: transactionId,
          amount: amountInCents(fields.total_amount),
          // Desktop page payments are CNY; the notify protocol has no currency field.
          currency: "cny",
        },
      ];
    },
  };
}
