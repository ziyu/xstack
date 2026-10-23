import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { createCipheriv, generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

// Local signed-provider fixture, never evidence of a real payment or merchant approval.
const project = resolve(process.argv[2] ?? "");
if (!project.startsWith(resolve(import.meta.dir, "../.smoke") + sep)) {
  throw new Error("Expected a disposable generated project inside apps/cli/.smoke");
}
const load = (path: string) => import(pathToFileURL(`${project}/${path}`).href);
const { createDb } = await load("packages/db/src/index.ts");
const { createPayment, plans } = await load("packages/payment/src/index.ts");
const { createCredits } = await load("packages/credits/src/index.ts");
const { createEventBus } = await load("packages/events/src/index.ts");
const { default: registerCredits } = await load("apps/web/src/integrations/payment-credits.ts");
const { createProvider: wechatProvider } = await load("packages/payment/src/providers/wechat.ts");
const { createProvider: alipayProvider } = await load("packages/payment/src/providers/alipay.ts");
const db = createDb({ DATABASE_URL: `file:${project}/local.db` });
const sqlite = new Database(`${project}/local.db`, { create: false, readwrite: true });
const events = createEventBus();
const credits = createCredits(db, events);
registerCredits({ events, credits });
const merchant = generateKeyPairSync("rsa", { modulusLength: 2048 });
const platform = generateKeyPairSync("rsa", { modulusLength: 2048 });
const env = {
  WECHAT_PAY_APP_ID: "wxpaymentfixture",
  WECHAT_PAY_MCH_ID: "1900000001",
  WECHAT_PAY_SERIAL_NO: "AABB0011",
  WECHAT_PAY_PRIVATE_KEY: merchant.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  WECHAT_PAY_API_V3_KEY: randomBytes(16).toString("hex"),
  WECHAT_PAY_PUBLIC_KEY: platform.publicKey.export({ type: "spki", format: "pem" }).toString(),
  ALIPAY_APP_ID: "2026000000000001",
  ALIPAY_SELLER_ID: "2088000000000001",
  WECHAT_PAY_PUBLIC_KEY_ID: "PUB_KEY_ID_1234567890",
  ALIPAY_PRIVATE_KEY: merchant.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  ALIPAY_PUBLIC_KEY: platform.publicKey.export({ type: "spki", format: "pem" }).toString(),
  ALIPAY_SANDBOX: true,
};
const baseUrl = "https://payment-fixture.example.test";
const payment = createPayment({ env, db, events, baseUrl });
const customer = { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` };
sqlite
  .query(
    "INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,1,?,?)",
  )
  .run(customer.id, "Payment fixture", customer.email, Date.now(), Date.now());
const starter = plans.find((plan: { id: string }) => plan.id === "starter");
assert.equal(starter.mode, "payment");
assert.equal(starter.currency, "cny");
const originalFetch = globalThis.fetch;
let badResponseSignature = false;
let checkoutRequests = 0;
function wxHeaders(body: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  const nonce = randomBytes(16).toString("hex");
  return {
    "Wechatpay-Timestamp": timestamp,
    "Wechatpay-Nonce": nonce,
    "Wechatpay-Serial": env.WECHAT_PAY_PUBLIC_KEY_ID,
    "Wechatpay-Signature": sign(
      "RSA-SHA256",
      Buffer.from(`${timestamp}\n${nonce}\n${body}\n`),
      platform.privateKey,
    ).toString("base64"),
  };
}
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== "https://api.mch.weixin.qq.com") return originalFetch(input, init);
  assert.equal(url.pathname, "/v3/pay/transactions/native");
  assert.equal(init?.method, "POST");
  const body = String(init?.body);
  const authorization = new Headers(init?.headers).get("authorization")!;
  const fields = Object.fromEntries(
    [...authorization.matchAll(/(\w+)="([^"]+)"/g)].map((match) => [match[1], match[2]]),
  );
  assert.equal(fields.mchid, env.WECHAT_PAY_MCH_ID);
  assert.equal(fields.serial_no, env.WECHAT_PAY_SERIAL_NO);
  assert.ok(
    verify(
      "RSA-SHA256",
      Buffer.from(`POST\n${url.pathname}\n${fields.timestamp}\n${fields.nonce_str}\n${body}\n`),
      merchant.publicKey,
      Buffer.from(fields.signature!, "base64"),
    ),
  );
  const order = JSON.parse(body);
  assert.match(order.out_trade_no, /^[a-f0-9]{32}$/);
  assert.deepEqual(order.amount, { total: starter.amount, currency: "CNY" });
  assert.equal(order.notify_url, `${baseUrl}/api/payment/webhook/wechat`);
  checkoutRequests++;
  const response = JSON.stringify({ code_url: "weixin://wxpay/bizpayurl/up?pr=fixture" });
  const headers = wxHeaders(response);
  if (badResponseSignature) headers["Wechatpay-Signature"] = "invalid";
  return new Response(response, { status: 200, headers });
}) as typeof fetch;
async function checkout(provider: string) {
  return payment.checkout({
    user: customer,
    planId: "starter",
    provider,
    successPath: "/en/dashboard/billing",
    cancelPath: "/en/pricing",
    checkoutPath: "/en/payment",
  });
}
function wxRequest(
  orderId: string,
  changes: {
    appid?: string;
    mchid?: string;
    amount?: { total: number; currency: string };
    transaction_id?: string;
  } = {},
  timestamp?: string,
) {
  const transaction = {
    appid: env.WECHAT_PAY_APP_ID,
    mchid: env.WECHAT_PAY_MCH_ID,
    out_trade_no: orderId,
    transaction_id: orderId,
    trade_type: "NATIVE",
    trade_state: "SUCCESS",
    amount: { total: starter.amount, currency: "CNY" },
    ...changes,
  };
  const nonce = randomBytes(6).toString("hex");
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(env.WECHAT_PAY_API_V3_KEY),
    Buffer.from(nonce),
  );
  cipher.setAAD(Buffer.from("transaction"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(transaction)),
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
  return new Request(`${baseUrl}/api/payment/webhook/wechat`, {
    method: "POST",
    body,
    headers: wxHeaders(body, timestamp),
  });
}
function aliRequest(
  orderId: string,
  changes: {
    app_id?: string;
    seller_id?: string;
    total_amount?: string;
    trade_status?: string;
  } = {},
) {
  const fields = {
    app_id: env.ALIPAY_APP_ID,
    seller_id: env.ALIPAY_SELLER_ID,
    notify_type: "trade_status_sync",
    out_trade_no: orderId,
    trade_no: `ali_${orderId}`,
    trade_status: "TRADE_SUCCESS",
    total_amount: (starter.amount / 100).toFixed(2),
    subject: "Fixture + unicode 中文 % value",
    ...changes,
  };
  const canonical = Object.entries(fields)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const signature = sign("RSA-SHA256", Buffer.from(canonical), platform.privateKey).toString(
    "base64",
  );
  return new Request(`${baseUrl}/api/payment/webhook/alipay`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...fields, sign_type: "RSA2", sign: signature }),
  });
}
const row = (id: string) =>
  sqlite.query("SELECT * FROM payment_order WHERE id=?").get(id) as {
    status: string;
    provider_ref: string;
  };
try {
  assert.deepEqual(payment.availableProviders("starter"), ["wechat", "alipay"]);
  for (const factory of [wechatProvider, alipayProvider]) {
    const provider = factory({ env, baseUrl });
    assert.equal(provider.supportsPlan({ ...starter, mode: "subscription" }), false);
    assert.equal(provider.supportsPlan({ ...starter, currency: "usd" }), false);
  }
  const qrUrl = new URL(await checkout("wechat"));
  const wxId = qrUrl.pathname.split("/").at(-1)!;
  assert.equal(qrUrl.origin, baseUrl);
  assert.equal(
    (await payment.getOrder(customer.id, wxId)).qrCodeUrl,
    "weixin://wxpay/bizpayurl/up?pr=fixture",
  );
  assert.equal(await payment.getOrder("another-user", wxId), undefined);
  badResponseSignature = true;
  await assert.rejects(checkout("wechat"));
  badResponseSignature = false;
  assert.equal(checkoutRequests, 2);
  const forged = wxRequest(wxId);
  forged.headers.set("Wechatpay-Signature", "invalid");
  await assert.rejects(payment.handleWebhook("wechat", forged));
  await assert.rejects(payment.handleWebhook("wechat", wxRequest(wxId, {}, "1")));
  const wrongKey = wxRequest(wxId);
  wrongKey.headers.set("Wechatpay-Serial", "wrong-key");
  await assert.rejects(payment.handleWebhook("wechat", wrongKey));
  for (const changes of [
    { mchid: "wrong-merchant" },
    { appid: "wrong-app" },
    { amount: { total: starter.amount + 1, currency: "CNY" } },
    { amount: { total: starter.amount, currency: "USD" } },
  ])
    await assert.rejects(payment.handleWebhook("wechat", wxRequest(wxId, changes)));
  assert.equal(row(wxId).status, "pending");
  assert.equal(await credits.getBalance(customer.id), 0);
  await payment.handleWebhook("wechat", wxRequest(wxId));
  await payment.handleWebhook("wechat", wxRequest(wxId));
  assert.equal(row(wxId).status, "paid");
  assert.equal(await credits.getBalance(customer.id), starter.credits);
  assert.equal((await payment.getOrder(customer.id, wxId)).qrCodeUrl, null);
  await assert.rejects(
    payment.handleWebhook("wechat", wxRequest(wxId, { transaction_id: "another-transaction" })),
  );

  const aliUrl = new URL(await checkout("alipay"));
  const biz = JSON.parse(aliUrl.searchParams.get("biz_content")!);
  const aliId = biz.out_trade_no;
  assert.equal(aliUrl.hostname, "openapi-sandbox.dl.alipaydev.com");
  assert.equal(biz.product_code, "FAST_INSTANT_TRADE_PAY");
  assert.equal(biz.total_amount, (starter.amount / 100).toFixed(2));
  const checkoutFields = Object.fromEntries(aliUrl.searchParams);
  const checkoutSignature = checkoutFields.sign!;
  delete checkoutFields.sign;
  assert.ok(
    verify(
      "RSA-SHA256",
      Buffer.from(
        Object.keys(checkoutFields)
          .sort()
          .map((key) => `${key}=${checkoutFields[key]}`)
          .join("&"),
      ),
      merchant.publicKey,
      Buffer.from(checkoutSignature, "base64"),
    ),
  );
  for (const changes of [
    { app_id: "wrong-app" },
    { seller_id: "wrong-seller" },
    { total_amount: "0.01" },
    { total_amount: "9e0" },
  ]) {
    await assert.rejects(payment.handleWebhook("alipay", aliRequest(aliId, changes)));
  }
  const tampered = aliRequest(aliId);
  await assert.rejects(
    payment.handleWebhook(
      "alipay",
      new Request(tampered.url, {
        method: "POST",
        headers: tampered.headers,
        body: `${await tampered.text()}&total_amount=0.01`,
      }),
    ),
  );
  await assert.rejects(payment.handleWebhook("alipay", aliRequest(wxId)));
  assert.equal(row(aliId).status, "pending");
  await payment.handleWebhook("alipay", aliRequest(aliId, { trade_status: "WAIT_BUYER_PAY" }));
  assert.equal(row(aliId).status, "pending");
  await payment.handleWebhook("alipay", aliRequest(aliId));
  await payment.handleWebhook("alipay", aliRequest(aliId, { trade_status: "TRADE_FINISHED" }));
  assert.equal(row(aliId).status, "paid");
  assert.equal(await credits.getBalance(customer.id), starter.credits * 2);
  const ledger = sqlite
    .query("SELECT COUNT(*) AS count FROM credit_transaction WHERE user_id=?")
    .get(customer.id) as { count: number };
  assert.equal(ledger.count, 2);
  console.log(
    "PASS: signed Native checkout/response, Alipay page checkout, merchant/app/signature/amount/currency/provider binding, owned QR, retry-safe credit grants. Local protocol fixtures only; no real payment.",
  );
} finally {
  globalThis.fetch = originalFetch;
  sqlite.close();
}
