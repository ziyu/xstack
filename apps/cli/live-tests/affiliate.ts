import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

// Local protocol fixture: real generated auth/DB/Stripe verifier/credit ledger.
// No Stripe purchase, external Siteverify request, or live provider evidence.
const project = resolve(process.argv[2] ?? "");
if (!project.startsWith(resolve(import.meta.dir, "../.smoke") + sep)) {
  throw new Error("Expected a disposable generated SQLite project under apps/cli/.smoke");
}
const load = (path: string) => import(pathToFileURL(`${project}/${path}`).href);
const { createDb } = await load("packages/db/src/index.ts");
const { createEventBus } = await load("packages/events/src/index.ts");
const { createAuth } = await load("packages/auth/src/index.ts");
const { createAffiliate } = await load("packages/affiliate/src/index.ts");
const { createCredits } = await load("packages/credits/src/index.ts");
const { createPayment, plans } = await load("packages/payment/src/index.ts");
const { default: registerSignup } = await load("apps/web/src/integrations/affiliate-signup.ts");
const { default: registerAffiliate } = await load("apps/web/src/integrations/affiliate-payment.ts");
const { default: registerCredits } = await load("apps/web/src/integrations/payment-credits.ts");
const db = createDb({ DATABASE_URL: `file:${project}/local.db` });
const sqlite = new Database(`${project}/local.db`, { create: false, readwrite: true });
const origin = "http://localhost:39841";
const secret = "affiliate-local-protocol-secret-2026-immutable";
const webhookSecret = "whsec_affiliate_local_protocol_only";
const events = createEventBus();
const affiliate = createAffiliate({ db, secret });
const credits = createCredits(db, events);
const payment = createPayment({
  db,
  events,
  baseUrl: origin,
  env: {
    NODE_ENV: "test",
    STRIPE_SECRET_KEY: "sk_test_protocol_fixture_only",
    STRIPE_WEBHOOK_SECRET: webhookSecret,
  },
});
registerSignup({ events, affiliate });
registerCredits({ events, credits });
registerAffiliate({ events, payment, affiliate, credits });
const auth = createAuth(
  {
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: secret,
    TURNSTILE_SITE_KEY: "local-protocol-site-key",
    TURNSTILE_SECRET_KEY: "local-protocol-secret-key",
  },
  db,
  events,
);
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert.equal(
    url.href,
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    "Unexpected external request",
  );
  const form = new URLSearchParams(String(init?.body));
  assert.equal(form.get("secret"), "local-protocol-secret-key");
  assert.match(form.get("response") ?? "", /^affiliate-fixture-/);
  return Response.json({
    success: true,
    hostname: "localhost",
    action: "signup",
    challenge_ts: new Date().toISOString(),
  });
}) as typeof fetch;
const userSchema = z.object({
  user: z.object({ id: z.string(), email: z.string() }).passthrough(),
});
const countSchema = z.object({ value: z.number() });
const count = (query: string, id: string) => countSchema.parse(sqlite.query(query).get(id)).value;
// Attribution scenarios require more signups than the auth rate window permits.
// Only age the local signup bucket; rate-limit behavior is verified separately.
const hasRateLimit =
  count("SELECT count(*) AS value FROM sqlite_master WHERE type='table' AND name=?", "rate_limit") >
  0;
function expireSignupWindow() {
  if (hasRateLimit)
    sqlite.query("UPDATE rate_limit SET last_request=0 WHERE key LIKE ?").run("%|/sign-up/email");
}
async function signup(token?: string) {
  expireSignupWindow();
  const headers = new Headers({
    origin,
    "content-type": "application/json",
    "x-captcha-token": `affiliate-fixture-${crypto.randomUUID()}`,
  });
  if (token) headers.set("cookie", `xstack_referral=${token}`);
  const response = await auth.handler(
    new Request(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Affiliate fixture",
        email: `affiliate-${crypto.randomUUID()}@example.test`,
        password: "Affiliate-protocol-password-2026!",
      }),
    }),
  );
  assert.equal(response.status, 200, await response.clone().text());
  const { user } = userSchema.parse(await response.json());
  assert.equal("affiliateReferralToken" in user, false, "Private attribution token leaked");
  return user;
}
async function rejectClientAttribution(attemptedToken: string, token?: string) {
  expireSignupWindow();
  const email = `affiliate-rejected-${crypto.randomUUID()}@example.test`;
  const headers = new Headers({
    origin,
    "content-type": "application/json",
    "x-captcha-token": `affiliate-fixture-${crypto.randomUUID()}`,
  });
  if (token) headers.set("cookie", `xstack_referral=${token}`);
  const response = await auth.handler(
    new Request(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Rejected affiliate claim",
        email,
        password: "Affiliate-protocol-password-2026!",
        affiliateReferralToken: attemptedToken,
      }),
    }),
  );
  assert.equal(response.status, 400, await response.clone().text());
  assert.equal(
    z.object({ code: z.string() }).parse(await response.json()).code,
    "FIELD_NOT_ALLOWED",
  );
  assert.equal(
    count("SELECT count(*) AS value FROM user WHERE email=?", email),
    0,
    "Rejected claim must not create an account",
  );
}
const planSchema = z.object({
  id: z.string(),
  credits: z.number().int(),
  amount: z.number().int(),
  currency: z.string(),
});
const plan = planSchema.parse(plans.find((item: { id: string }) => item.id === "starter"));
const expected = Math.floor((plan.credits * affiliate.commissionPercent) / 100);
assert.ok(expected > 0, "Fixture requires nonzero affiliate.commissionPercent");
function seedOrder(userId: string) {
  const id = crypto.randomUUID();
  sqlite
    .query(
      "INSERT INTO payment_order (id,user_id,plan_id,provider,provider_ref,status,amount,currency,created_at) VALUES (?,?,?,'stripe',?,'pending',?,?,?)",
    )
    .run(id, userId, plan.id, `cs_${id}`, plan.amount, plan.currency, Date.now());
  return id;
}
type StripeEventObject =
  | { id: string; object: "checkout.session"; client_reference_id: string; payment_status: "paid" }
  | {
      id: string;
      metadata: { userId: string; planId: string };
      status: "active";
      customer: string;
      items: { data: { current_period_end: number }[] };
      cancel_at_period_end: boolean;
    }
  | {
      id: string;
      billing_reason: string;
      parent: { subscription_details: { subscription: string } };
      amount_paid: number;
      currency: string;
    }
  | { id: string; amount_refunded: number };
function stripeEvent(type: string, object: StripeEventObject, corrupt = false) {
  const body = JSON.stringify({
    id: `evt_${crypto.randomUUID()}`,
    object: "event",
    type,
    data: { object },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return new Request(`${origin}/api/payment/webhook/stripe`, {
    method: "POST",
    body,
    headers: { "stripe-signature": `t=${timestamp},v1=${corrupt ? "0".repeat(64) : signature}` },
  });
}
function paid(orderId: string, corrupt = false) {
  return payment.handleWebhook(
    "stripe",
    stripeEvent(
      "checkout.session.completed",
      {
        id: `cs_${orderId}`,
        object: "checkout.session",
        client_reference_id: orderId,
        payment_status: "paid",
      },
      corrupt,
    ),
  );
}
function expiredToken(code: string) {
  const issuedAt = Date.now() - 172_800_000;
  const payload = Buffer.from(
    JSON.stringify({ code, issuedAt, expiresAt: issuedAt + 86_400_000 }),
  ).toString("base64url");
  const signature = createHmac("sha256", `affiliate-cookie:v1:${secret}`)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}
try {
  const inviter = await signup();
  const alternate = await signup();
  const code = await affiliate.getCode(inviter.id);
  const otherCode = await affiliate.getCode(alternate.id);
  assert.equal(await affiliate.capture("0".repeat(32), undefined), undefined);
  const token = z.string().parse(await affiliate.capture(code, undefined));
  const otherToken = z.string().parse(await affiliate.capture(otherCode, undefined));
  assert.equal(await affiliate.capture(otherCode, token), token, "First touch must win");
  await rejectClientAttribution(otherToken, token);
  const referred = await signup(token);
  const binding = z
    .object({ referrer_id: z.string() })
    .parse(
      sqlite.query("SELECT referrer_id FROM affiliate_referral WHERE user_id=?").get(referred.id),
    );
  assert.equal(binding.referrer_id, inviter.id, "Client cannot override captured cookie");
  await affiliate.bindSignup(referred.id);
  assert.equal(
    count("SELECT count(*) AS value FROM affiliate_referral WHERE user_id=?", referred.id),
    1,
  );
  for (const invalid of [`${token.slice(0, -5)}aaaaa`, expiredToken(code)]) {
    const account = await signup(invalid);
    assert.equal(
      count("SELECT count(*) AS value FROM affiliate_referral WHERE user_id=?", account.id),
      0,
    );
  }
  await rejectClientAttribution(token);
  // Corrupted persisted self-claim must not bypass domain protection.
  sqlite
    .query("UPDATE user SET affiliate_referral_token=?,created_at=? WHERE id=?")
    .run(token, Date.now(), inviter.id);
  await affiliate.bindSignup(inviter.id);
  assert.equal(
    count("SELECT count(*) AS value FROM affiliate_referral WHERE user_id=?", inviter.id),
    0,
  );

  const order = seedOrder(referred.id);
  await assert.rejects(paid(order, true), "Invalid signature must not award");
  assert.equal(await credits.getBalance(inviter.id), 0);
  await Promise.all(Array.from({ length: 6 }, () => paid(order)));
  assert.equal(await credits.getBalance(inviter.id), expected);
  assert.equal(
    count(
      "SELECT count(*) AS value FROM credit_transaction WHERE reference_id=?",
      `affiliate:${order}`,
    ),
    1,
  );
  assert.equal((await affiliate.report(alternate.id)).convertedOrders, 0, "Owned report isolation");
  await assert.rejects(
    credits.grant(alternate.id, expected, { type: "affiliate", referenceId: `affiliate:${order}` }),
    "Reference owner mismatch must reject",
  );

  // A real DB error after grant leaves an intent; replay must not credit twice.
  const retryOrder = seedOrder(referred.id);
  sqlite.exec(
    "CREATE TRIGGER affiliate_fixture_fail_finalize BEFORE UPDATE OF status ON affiliate_commission WHEN NEW.status='granted' BEGIN SELECT RAISE(FAIL, 'fixture finalization failure'); END",
  );
  try {
    await assert.rejects(paid(retryOrder));
  } finally {
    sqlite.exec("DROP TRIGGER affiliate_fixture_fail_finalize");
  }
  const afterGrant = await credits.getBalance(inviter.id);
  await paid(retryOrder);
  assert.equal(await credits.getBalance(inviter.id), afterGrant);
  assert.equal(afterGrant, expected * 2);
  assert.equal((await affiliate.report(inviter.id)).pendingCredits, 0);

  // A failed after-create binding must not break signup; payment repairs it.
  sqlite.exec(
    "CREATE TRIGGER affiliate_fixture_fail_signup BEFORE INSERT ON affiliate_referral BEGIN SELECT RAISE(FAIL, 'fixture signup attribution failure'); END",
  );
  let deferred: { id: string; email: string };
  try {
    deferred = await signup(token);
  } finally {
    sqlite.exec("DROP TRIGGER affiliate_fixture_fail_signup");
  }
  assert.equal(
    count("SELECT count(*) AS value FROM affiliate_referral WHERE user_id=?", deferred.id),
    0,
  );
  await paid(seedOrder(deferred.id));
  assert.equal(
    count("SELECT count(*) AS value FROM affiliate_referral WHERE user_id=?", deferred.id),
    1,
  );
  assert.equal(await credits.getBalance(inviter.id), expected * 3);

  // Exercise actual supported renewal protocol; renewals grant buyer credits, not commissions.
  const subscription = `sub_${crypto.randomUUID()}`;
  await payment.handleWebhook(
    "stripe",
    stripeEvent("customer.subscription.created", {
      id: subscription,
      metadata: { userId: referred.id, planId: plan.id },
      status: "active",
      customer: "cus_fixture",
      items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 86400 }] },
      cancel_at_period_end: false,
    }),
  );
  const invoice = {
    id: `in_${crypto.randomUUID()}`,
    billing_reason: "subscription_cycle",
    parent: { subscription_details: { subscription } },
    amount_paid: plan.amount,
    currency: plan.currency,
  };
  await Promise.all(
    Array.from({ length: 3 }, () =>
      payment.handleWebhook("stripe", stripeEvent("invoice.paid", invoice)),
    ),
  );
  assert.equal(await credits.getBalance(inviter.id), expected * 3);
  const beforeRefund = await credits.getBalance(inviter.id);
  await payment.handleWebhook(
    "stripe",
    stripeEvent("charge.refunded", { id: "ch_fixture", amount_refunded: plan.amount }),
  );
  assert.equal(
    await credits.getBalance(inviter.id),
    beforeRefund,
    "No refund domain event: manual reversal is required",
  );
  console.log(
    "PASS affiliate local protocol: auth signup attribution, private input protection, signature/expiry/self checks, parallel payment replay, post-grant recovery, deferred signup recovery, ownership, renewal exclusion; refunds explicitly manual. No live provider calls.",
  );
} finally {
  globalThis.fetch = originalFetch;
  sqlite.close();
}
