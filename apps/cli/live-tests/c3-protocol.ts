import assert from "node:assert/strict";
import { createCipheriv, createHmac, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { readC2Applications } from "./c2-applications";

// Only local signed protocol evidence: no cloud purchase or merchant approval.
const project = await realpath(path.resolve(process.argv[2] ?? ""));
const smoke = await realpath(path.resolve(import.meta.dir, "../.smoke"));
assert.ok(project.startsWith(smoke + path.sep), "Expected a disposable generated workspace");
const { targets } = await readC2Applications(project);
// Generated package specifiers are selected from the runtime workspace, not this repository.
const load = (file: string) => import(pathToFileURL(path.join(project, file)).href);
const { createDb } = await load("packages/db/src/index.ts");
const { user } = await load("packages/db/src/schema/auth.ts");
const { paymentOrder } = await load("packages/db/src/schema/payment.ts");
const { affiliateReferral, affiliateCommission } = await load(
  "packages/db/src/schema/affiliate.ts",
);
const { createEventBus } = await load("packages/events/src/index.ts");
const { createPayment, plans } = await load("packages/payment/src/index.ts");
const { createCredits } = await load("packages/credits/src/index.ts");
const { createAffiliate } = await load("packages/affiliate/src/index.ts");
const { default: registerCredits } = await load(
  `${targets.backend.directory}/src/integrations/payment-credits.ts`,
);
const { default: registerAffiliate } = await load(
  `${targets.backend.directory}/src/integrations/affiliate-payment.ts`,
);
const db = createDb({ DATABASE_URL: process.env.DATABASE_URL ?? `file:${project}/local.db` });
const events = createEventBus();
const credits = createCredits(db, events);
const affiliate = createAffiliate({ db, secret: "c3-local-attribution-secret-not-cloud" });
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const secret = "c3-signed-webhook-local-secret";
const env = {
  NODE_ENV: "test",
  STRIPE_SECRET_KEY: "sk_test_c3_local_only",
  STRIPE_WEBHOOK_SECRET: secret,
  POLAR_ACCESS_TOKEN: "polar_c3_local_only",
  POLAR_WEBHOOK_SECRET: secret,
  WECHAT_PAY_APP_ID: "wxc3local",
  WECHAT_PAY_MCH_ID: "1900000001",
  WECHAT_PAY_SERIAL_NO: "C30001",
  WECHAT_PAY_PRIVATE_KEY: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  WECHAT_PAY_PUBLIC_KEY: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  WECHAT_PAY_PUBLIC_KEY_ID: "PUB_KEY_ID_30001",
  WECHAT_PAY_API_V3_KEY: randomBytes(16).toString("hex"),
  ALIPAY_APP_ID: "2026000000000001",
  ALIPAY_SELLER_ID: "2088000000000001",
  ALIPAY_SANDBOX: true,
  ALIPAY_PRIVATE_KEY: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  ALIPAY_PUBLIC_KEY: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
};
const payment = createPayment({
  db,
  events,
  env,
  baseUrl: targets.backend.origin,
  clientOrigins: [targets.public.origin],
});
registerCredits({ events, credits });
registerAffiliate({ events, payment, affiliate, credits });
const plan = plans.find((item: { id: string }) => item.id === "starter");
assert.ok(plan && plan.credits > 0);
const providers = ["stripe", "polar", "wechat", "alipay", "mock"];
assert.deepEqual(
  [...payment.providers].sort(),
  [...providers].sort(),
  "Generated provider selection",
);
assert.deepEqual(
  [...payment.availableProviders(plan.id)].sort(),
  [...providers].sort(),
  "Configured provider selection",
);
const account = async (token?: string) => {
  const entry = {
    id: crypto.randomUUID(),
    name: "C3 protocol",
    email: `c3-${crypto.randomUUID()}@example.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    affiliateReferralToken: token,
  };
  await db.insert(user).values(entry);
  return entry;
};
function callback(
  provider: string,
  orderId: string,
  corrupt = false,
  settlement: { amount?: number; currency?: string } = {},
): Request {
  const amount = settlement.amount ?? plan.amount;
  const currency = settlement.currency ?? plan.currency;
  const url = `${targets.backend.origin}/api/payment/webhook/${provider}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  if (provider === "stripe") {
    const body = JSON.stringify({
      id: `evt_${crypto.randomUUID()}`,
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_${orderId}`,
          object: "checkout.session",
          client_reference_id: orderId,
          payment_status: "paid",
          amount_total: amount,
          currency,
        },
      },
    });
    const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    return new Request(url, {
      method: "POST",
      body,
      headers: { "stripe-signature": `t=${timestamp},v1=${corrupt ? "0".repeat(64) : signature}` },
    });
  }
  if (provider === "polar") {
    const id = crypto.randomUUID();
    const body = JSON.stringify({
      type: "order.paid",
      timestamp: new Date().toISOString(),
      data: {
        id: crypto.randomUUID(),
        checkout_id: `polar_${orderId}`,
        customer_id: crypto.randomUUID(),
        billing_reason: "purchase",
        total_amount: amount,
        currency,
        metadata: { orderId },
      },
    });
    const signature = createHmac("sha256", secret)
      .update(`${id}.${timestamp}.${body}`)
      .digest("base64");
    return new Request(url, {
      method: "POST",
      body,
      headers: {
        "webhook-id": id,
        "webhook-timestamp": timestamp,
        "webhook-signature": `v1,${corrupt ? Buffer.alloc(32).toString("base64") : signature}`,
      },
    });
  }
  if (provider === "wechat") {
    const nonce = randomBytes(6).toString("hex");
    const cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(env.WECHAT_PAY_API_V3_KEY),
      Buffer.from(nonce),
    );
    cipher.setAAD(Buffer.from("transaction"));
    const transaction = JSON.stringify({
      appid: env.WECHAT_PAY_APP_ID,
      mchid: env.WECHAT_PAY_MCH_ID,
      out_trade_no: orderId,
      transaction_id: orderId,
      trade_type: "NATIVE",
      trade_state: "SUCCESS",
      amount: { total: amount, currency: currency.toUpperCase() },
    });
    const ciphertext = Buffer.concat([
      cipher.update(transaction),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString("base64");
    const body = JSON.stringify({
      id: crypto.randomUUID(),
      event_type: "TRANSACTION.SUCCESS",
      resource_type: "encrypt-resource",
      resource: {
        algorithm: "AEAD_AES_256_GCM",
        original_type: "transaction",
        nonce,
        associated_data: "transaction",
        ciphertext,
      },
    });
    const signature = sign(
      "RSA-SHA256",
      Buffer.from(`${timestamp}\n${nonce}\n${body}\n`),
      keys.privateKey,
    ).toString("base64");
    return new Request(url, {
      method: "POST",
      body,
      headers: {
        "Wechatpay-Timestamp": timestamp,
        "Wechatpay-Nonce": nonce,
        "Wechatpay-Serial": env.WECHAT_PAY_PUBLIC_KEY_ID,
        "Wechatpay-Signature": corrupt ? "invalid" : signature,
      },
    });
  }
  if (provider === "alipay") {
    const fields = {
      app_id: env.ALIPAY_APP_ID,
      seller_id: env.ALIPAY_SELLER_ID,
      notify_type: "trade_status_sync",
      out_trade_no: orderId,
      trade_no: `ali_${orderId}`,
      trade_status: "TRADE_SUCCESS",
      total_amount: (amount / 100).toFixed(2),
    };
    const canonical = Object.entries(fields)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `${key}=${value}`)
      .join("&");
    const signature = sign("RSA-SHA256", Buffer.from(canonical), keys.privateKey).toString(
      "base64",
    );
    return new Request(url, {
      method: "POST",
      body: new URLSearchParams({
        ...fields,
        sign_type: "RSA2",
        sign: corrupt ? "invalid" : signature,
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
  }
  return new Request(url, { method: "POST", body: new URLSearchParams({ orderId }) });
}
const originalFetch = globalThis.fetch;
// This domain fixture must never issue a provider request (orders below are explicit fixtures).
globalThis.fetch = Object.assign(
  async (input: Parameters<typeof fetch>[0]) => {
    throw new Error(`Unexpected network request: ${String(input)}`);
  },
  { preconnect: originalFetch.preconnect },
);
try {
  const inviter = await account();
  const outsider = await account();
  const code = await affiliate.getCode(inviter.id);
  const token = z
    .string()
    .min(1)
    .parse(await affiliate.capture(code, undefined));
  const buyer = await account(token);
  await Promise.all(Array.from({ length: 6 }, () => affiliate.bindSignup(buyer.id)));
  const referrals = await db.select().from(affiliateReferral);
  assert.equal(referrals.filter((row: { userId: string }) => row.userId === buyer.id).length, 1);
  const commission = Math.floor((plan.credits * affiliate.commissionPercent) / 100);
  assert.ok(commission > 0);
  for (const [index, provider] of providers.entries()) {
    const orderId = crypto.randomUUID().replaceAll("-", "");
    await db.insert(paymentOrder).values({
      id: orderId,
      userId: buyer.id,
      planId: plan.id,
      provider,
      status: "pending",
      amount: plan.amount,
      currency: plan.currency,
    });
    assert.equal(await payment.getOrder(outsider.id, orderId), undefined);
    if (provider !== "mock") {
      await assert.rejects(payment.handleWebhook(provider, callback(provider, orderId, true)));
      await assert.rejects(
        payment.handleWebhook(
          provider,
          callback(provider, orderId, false, { amount: plan.amount + 1 }),
        ),
      );
      if (provider !== "alipay")
        await assert.rejects(
          payment.handleWebhook(provider, callback(provider, orderId, false, { currency: "usd" })),
        );
      assert.equal((await payment.getOrder(buyer.id, orderId)).status, "pending");
      assert.equal(await credits.getBalance(buyer.id), index * plan.credits);
      assert.equal(await credits.getBalance(inviter.id), index * commission);
    }
    await Promise.all(
      Array.from({ length: 6 }, () => payment.handleWebhook(provider, callback(provider, orderId))),
    );
    assert.equal((await payment.getOrder(buyer.id, orderId)).status, "paid");
    assert.equal(await credits.getBalance(buyer.id), (index + 1) * plan.credits);
    assert.equal(await credits.getBalance(inviter.id), (index + 1) * commission);
    assert.equal(
      (await credits.listTransactions(buyer.id)).filter(
        (entry: { referenceId: string }) => entry.referenceId === `order:${orderId}`,
      ).length,
      1,
    );
    assert.equal(
      (await credits.listTransactions(inviter.id)).filter(
        (entry: { referenceId: string }) => entry.referenceId === `affiliate:${orderId}`,
      ).length,
      1,
    );
    const commissions = await db.select().from(affiliateCommission);
    assert.equal(
      commissions.filter((entry: { orderId: string }) => entry.orderId === orderId).length,
      1,
    );
  }
  assert.equal(await credits.getBalance(outsider.id), 0);
  assert.equal((await affiliate.report(outsider.id)).convertedOrders, 0);
  const consumer = await account();
  const referenceId = `c3-grant:${consumer.id}`;
  await Promise.all(
    Array.from({ length: 8 }, () =>
      credits.grant(consumer.id, 100, { type: "adjust", referenceId }),
    ),
  );
  await assert.rejects(credits.grant(outsider.id, 100, { type: "adjust", referenceId }));
  const debits = await Promise.allSettled(
    Array.from({ length: 8 }, (_, index) =>
      credits.consume(consumer.id, 30, { referenceId: `c3-debit:${consumer.id}:${index}` }),
    ),
  );
  assert.equal(debits.filter((result) => result.status === "fulfilled").length, 3);
  assert.equal(await credits.getBalance(consumer.id), 10);
  const ledger = await credits.listTransactions(consumer.id);
  assert.equal(ledger.length, 4);
  assert.equal(
    ledger.reduce((sum: number, entry: { amount: number }) => sum + entry.amount, 0),
    10,
  );
  assert.equal(
    new Set(ledger.map((entry: { referenceId: string }) => entry.referenceId)).size,
    ledger.length,
  );
  const debit = ledger.find((entry: { amount: number }) => entry.amount < 0);
  assert.equal(await credits.refund(outsider.id, debit.referenceId), null);
  await Promise.all(
    Array.from({ length: 6 }, () => credits.refund(consumer.id, debit.referenceId)),
  );
  assert.equal(await credits.getBalance(consumer.id), 40);
  const checkout = {
    user: buyer,
    planId: plan.id,
    provider: "mock",
    successPath: "/en/dashboard/billing",
    cancelPath: "/en/pricing",
    returnOrigin: targets.public.origin,
  };
  const mock = new URL(await payment.checkout(checkout));
  assert.equal(new URL(mock.searchParams.get("success")!).origin, targets.public.origin);
  await assert.rejects(
    payment.checkout({ ...checkout, returnOrigin: "https://attacker.example.test" }),
  );
  await assert.rejects(
    payment.checkout({ ...checkout, successPath: "//attacker.example.test/steal" }),
  );
  const production = createPayment({
    db,
    events,
    env: { ...env, NODE_ENV: "production" },
    baseUrl: targets.backend.origin,
  });
  assert.ok(!production.availableProviders(plan.id).includes("mock"));
  await assert.rejects(production.handleWebhook("mock", callback("mock", "unowned")));
  console.log(
    "PASS C3: five selected providers; signed forged/replayed callbacks; one buyer grant and referral commission per order; concurrent debit/ledger/refund safety; cross-user isolation; validated return origins. Local fixtures only, no real payment.",
  );
} finally {
  globalThis.fetch = originalFetch;
  if ((process.env.DATABASE_URL ?? "file:").startsWith("file:")) await db.$client.close();
  else await db.$client.end();
}
