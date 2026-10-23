import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
  randomBytes,
  sign,
  verify,
} from "node:crypto";

import { z } from "zod";

import type { PaymentProvider, Plan, ProviderOptions, WebhookEvent } from "../types";

export type ProviderConfig = {
  WECHAT_PAY_APP_ID?: string;
  WECHAT_PAY_MCH_ID?: string;
  WECHAT_PAY_SERIAL_NO?: string;
  WECHAT_PAY_PRIVATE_KEY?: string;
  WECHAT_PAY_API_V3_KEY?: string;
  WECHAT_PAY_PUBLIC_KEY_ID?: string;
  WECHAT_PAY_PUBLIC_KEY?: string;
};

type WeChatCredentials = {
  appId: string;
  mchId: string;
  serialNo: string;
  publicKeyId: string;
  apiV3Key: Buffer;
  privateKey: KeyObject;
  publicKey: KeyObject;
};

const REQUIRED = [
  "WECHAT_PAY_APP_ID",
  "WECHAT_PAY_MCH_ID",
  "WECHAT_PAY_SERIAL_NO",
  "WECHAT_PAY_PRIVATE_KEY",
  "WECHAT_PAY_API_V3_KEY",
  "WECHAT_PAY_PUBLIC_KEY_ID",
  "WECHAT_PAY_PUBLIC_KEY",
] as const;
const NATIVE_PATH = "/v3/pay/transactions/native";
const ORDER_ID = /^[A-Za-z0-9_\-|*]{6,32}$/;

function supportsPlan(plan: Plan): boolean {
  return (
    plan.mode === "payment" &&
    plan.currency.toLowerCase() === "cny" &&
    Number.isSafeInteger(plan.amount) &&
    plan.amount > 0
  );
}

const base64Schema = z
  .string()
  .min(1)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const checkoutSchema = z.object({ code_url: z.string().startsWith("weixin://wxpay/bizpayurl/") });
const notificationSchema = z.object({ event_type: z.string() });
const resourceSchema = z.object({
  resource_type: z.literal("encrypt-resource"),
  resource: z.object({
    original_type: z.literal("transaction"),
    algorithm: z.literal("AEAD_AES_256_GCM"),
    nonce: z.string().refine((value) => Buffer.byteLength(value, "utf8") === 12),
    associated_data: z.string().optional(),
    ciphertext: base64Schema,
  }),
});
const transactionSchema = z.object({
  appid: z.string(),
  mchid: z.string(),
  trade_state: z.literal("SUCCESS"),
  trade_type: z.literal("NATIVE"),
  amount: z.object({
    currency: z.literal("CNY"),
    total: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
  out_trade_no: z.string().regex(ORDER_ID),
  transaction_id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
});

export function createProvider({ env, baseUrl }: ProviderOptions<ProviderConfig>): PaymentProvider {
  let config: WeChatCredentials | undefined;
  function credentials(): WeChatCredentials {
    if (config) return config;
    for (const name of REQUIRED) {
      if (!env[name]?.trim()) throw new Error(`${name} is not set; see docs/modules/payment.md`);
    }
    const appId = env.WECHAT_PAY_APP_ID!;
    const mchId = env.WECHAT_PAY_MCH_ID!;
    const serialNo = env.WECHAT_PAY_SERIAL_NO!;
    const publicKeyId = env.WECHAT_PAY_PUBLIC_KEY_ID!;
    if (
      !/^[A-Za-z0-9]{1,32}$/.test(appId) ||
      !/^[0-9]{1,32}$/.test(mchId) ||
      !/^[A-Fa-f0-9]+$/.test(serialNo) ||
      !/^PUB_KEY_ID_[0-9]+$/.test(publicKeyId)
    ) {
      throw new Error(
        "Invalid WeChat Pay app ID, merchant ID, certificate serial or public key ID",
      );
    }
    const apiV3Key = Buffer.from(env.WECHAT_PAY_API_V3_KEY!, "utf8");
    if (apiV3Key.length !== 32)
      throw new Error("WECHAT_PAY_API_V3_KEY must contain exactly 32 bytes");
    const privateKey = createPrivateKey(env.WECHAT_PAY_PRIVATE_KEY!.replace(/\\n/g, "\n"));
    const publicKey = createPublicKey(env.WECHAT_PAY_PUBLIC_KEY!.replace(/\\n/g, "\n"));
    if (privateKey.asymmetricKeyType !== "rsa" || publicKey.asymmetricKeyType !== "rsa") {
      throw new Error("WeChat Pay requires RSA private and public keys");
    }
    config = { appId, mchId, serialNo, publicKeyId, apiV3Key, privateKey, publicKey };
    return config;
  }

  function verifyMessage(headers: Headers, body: string): void {
    const { publicKeyId, publicKey } = credentials();
    const timestamp = headers.get("wechatpay-timestamp");
    const nonce = headers.get("wechatpay-nonce");
    if (
      headers.get("wechatpay-serial") !== publicKeyId ||
      !timestamp ||
      !/^[0-9]+$/.test(timestamp) ||
      !Number.isSafeInteger(Number(timestamp)) ||
      Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300 ||
      !nonce ||
      /[\r\n]/.test(nonce)
    ) {
      throw new Error("Invalid WeChat Pay signature headers, key ID or timestamp");
    }
    const signature = Buffer.from(base64Schema.parse(headers.get("wechatpay-signature")), "base64");
    if (
      !verify("RSA-SHA256", Buffer.from(`${timestamp}\n${nonce}\n${body}\n`), publicKey, signature)
    ) {
      throw new Error("Invalid WeChat Pay signature");
    }
  }

  return {
    id: "wechat",
    configured: REQUIRED.every((name) => Boolean(env[name]?.trim())),
    supportsPlan,

    async createCheckout({ orderId, plan }) {
      const { appId, mchId, serialNo, publicKeyId, privateKey } = credentials();
      if (!supportsPlan(plan))
        throw new Error("WeChat Pay only supports positive one-time CNY payments");
      if (!ORDER_ID.test(orderId)) throw new Error("Invalid WeChat Pay merchant order ID");
      const body = JSON.stringify({
        appid: appId,
        mchid: mchId,
        description: plan.id,
        out_trade_no: orderId,
        notify_url: new URL("/api/payment/webhook/wechat", baseUrl).toString(),
        amount: { total: plan.amount, currency: "CNY" },
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = randomBytes(16).toString("hex");
      const signature = sign(
        "RSA-SHA256",
        Buffer.from(`POST\n${NATIVE_PATH}\n${timestamp}\n${nonce}\n${body}\n`),
        privateKey,
      ).toString("base64");
      const response = await fetch(`https://api.mch.weixin.qq.com${NATIVE_PATH}`, {
        method: "POST",
        redirect: "manual",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Wechatpay-Serial": publicKeyId,
          Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${serialNo}",signature="${signature}"`,
        },
        body,
      });
      const responseBody = await response.text();
      // Verify the original bytes before parsing or trusting a checkout URL.
      verifyMessage(response.headers, responseBody);
      if (!response.ok) throw new Error(`WeChat Pay checkout failed with HTTP ${response.status}`);
      const { code_url: codeUrl } = checkoutSchema.parse(JSON.parse(responseBody));
      return { url: codeUrl, qrCodeUrl: codeUrl, providerRef: orderId };
    },

    async parseWebhook(request): Promise<WebhookEvent[]> {
      const { appId, mchId, apiV3Key } = credentials();
      if (request.method !== "POST") throw new Error("WeChat Pay notifications require POST");
      const body = await request.text();
      verifyMessage(request.headers, body);
      const parsed: unknown = JSON.parse(body);
      const notification = notificationSchema.parse(parsed);
      if (notification.event_type !== "TRANSACTION.SUCCESS") return [];
      const { resource } = resourceSchema.parse(parsed);
      const encrypted = Buffer.from(resource.ciphertext, "base64");
      if (encrypted.length <= 16) throw new Error("Invalid WeChat Pay notification ciphertext");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        apiV3Key,
        Buffer.from(resource.nonce, "utf8"),
      );
      decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
      decipher.setAAD(Buffer.from(resource.associated_data ?? "", "utf8"));
      const plaintext = Buffer.concat([
        decipher.update(encrypted.subarray(0, encrypted.length - 16)),
        decipher.final(),
      ]).toString("utf8");
      const transaction = transactionSchema.parse(JSON.parse(plaintext));
      const { amount } = transaction;
      if (transaction.appid !== appId || transaction.mchid !== mchId) {
        throw new Error("Invalid WeChat Pay merchant or app identity");
      }
      return [
        {
          type: "checkout.completed",
          orderId: transaction.out_trade_no,
          providerRef: transaction.transaction_id,
          amount: amount.total,
          currency: "cny",
        },
      ];
    },
  };
}
