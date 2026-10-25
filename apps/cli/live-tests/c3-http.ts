import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { C2Targets } from "./c2-applications";
import type { C2Database, C2Result } from "./c2-http";
type RequestBody = {
  name?: string;
  email?: string;
  password?: string;
  planId?: string;
  provider?: string;
  locale?: string;
  returnOrigin?: string;
  amount?: number;
  reason?: string;
};

class Client {
  readonly cookies = new Map<string, string>();
  constructor(readonly origin: string) {}
  async request(route: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("origin", headers.get("origin") ?? this.origin);
    headers.set("cookie", [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    const response = await fetch(new URL(route, this.origin), {
      ...init,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(";", 1)[0]!;
      const separator = pair.indexOf("=");
      this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return response;
  }
  async page(route: string) {
    const response = await this.request(route);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const target = new URL(response.headers.get("location") ?? "", this.origin);
    const requested = new URL(route, this.origin);
    if (target.origin !== requested.origin || target.pathname !== requested.pathname)
      return response;
    return this.request(`${target.pathname}${target.search}`);
  }
  post(route: string, body: RequestBody, headers: Record<string, string> = {}) {
    return this.request(route, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }
}

export async function exerciseC3Http(input: {
  project: string;
  targets: C2Targets;
  database: C2Database;
  fixture: string;
  administrator: string;
  results: C2Result[];
  save: () => Promise<void>;
  signal: AbortSignal;
}) {
  const { project, targets, database, results, save, signal } = input;
  const member = new Client(targets.public.origin);
  const outsider = new Client(targets.public.origin);
  const admin = new Client(targets.admin.origin);
  const anonymous = new Client(targets.public.origin);
  const check = async (name: string, work: () => Promise<void>) => {
    signal.throwIfAborted();
    try {
      await work();
      results.push({ name, status: "passed" });
    } catch (error) {
      results.push({ name, status: "failed", detail: String(error) });
      throw error;
    } finally {
      await save();
    }
  };
  const ok = async (response: Response) => {
    assert.equal(response.status, 200, `${response.url}: ${await response.clone().text()}`);
    return response;
  };
  const denied = async (response: Response) => {
    assert.ok(
      response.status >= 400 && response.status < 500,
      `${response.url}: expected denial, got ${response.status} ${await response.clone().text()}`,
    );
  };
  const signup = async (client: Client, email: string) => {
    const password = "C3-Local-Protocol-Password-728!";
    const token = async (action: string) => {
      const response = await ok(
        await fetch(`${input.fixture}/issue`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, hostname: new URL(client.origin).hostname }),
          signal,
        }),
      );
      return z.object({ token: z.string() }).parse(await response.json()).token;
    };
    await database.clearLimits();
    const created = await ok(
      await client.post(
        "/api/auth/sign-up/email",
        { name: "C3 HTTP", email, password },
        { "x-captcha-token": await token("signup") },
      ),
    );
    const account = z.object({ user: z.object({ id: z.string() }) }).parse(await created.json());
    // C2 covers real email verification. This C3 fixture explicitly seeds verified state only.
    await database.query('UPDATE "user" SET email_verified = true WHERE id = ?', [account.user.id]);
    if (email === input.administrator)
      await database.query('UPDATE "user" SET role = ? WHERE id = ?', ["admin", account.user.id]);
    await database.clearLimits();
    await ok(
      await client.post(
        "/api/auth/sign-in/email",
        { email, password },
        { "x-captcha-token": await token("login") },
      ),
    );
    return account.user.id;
  };
  let productApi = false;
  try {
    await access(path.join(project, targets.backend.directory, "src/lib/native/payment.ts"));
    productApi = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let memberId = "";
  await check("c3-real-auth-session-local-verified-accounts", async () => {
    memberId = await signup(member, `c3-member-${crypto.randomUUID()}@example.test`);
    await signup(outsider, `c3-outsider-${crypto.randomUUID()}@example.test`);
    await signup(admin, input.administrator);
  });
  await check("c3-public-pricing-and-authenticated-SSR-pages", async () => {
    await ok(await anonymous.page("/en/pricing"));
    for (const route of [
      "/en/dashboard/billing",
      "/en/dashboard/credits",
      "/en/dashboard/affiliate",
    ])
      await ok(await member.page(route));
    for (const route of ["/en/admin/orders", "/en/admin/credits", "/en/admin/affiliate"])
      await ok(await admin.page(route));
  });
  await check("c3-public-mock-webhook-disabled", async () => {
    assert.equal(
      (
        await anonymous.request("/api/payment/webhook/mock", {
          method: "POST",
          body: "orderId=forged",
        })
      ).status,
      404,
    );
  });
  if (!productApi) {
    await check("c3-server-action-adapter-admin-page-denial", async () => {
      for (const route of ["/en/admin/orders", "/en/admin/credits", "/en/admin/affiliate"]) {
        const response = await member.request(route);
        const html = await response.text();
        assert.ok(
          [301, 302, 303, 307, 308, 401, 403, 404].includes(response.status) ||
            (response.status === 200 && /NEXT_REDIRECT/.test(html)),
          `${route}: ordinary user was not denied`,
        );
      }
    });
    return;
  }
  const creditState = async (client: Client, query = "") =>
    z
      .object({
        balance: z.number(),
        transactions: z.array(z.object({ referenceId: z.string().nullable(), userId: z.string() })),
      })
      .parse(await (await ok(await client.request(`/api/product/credits${query}`))).json());
  const before = await creditState(member);
  const otherBefore = await creditState(outsider);
  let orderId = "";
  let paymentUrl: URL;
  let planCredits = 0;
  await check("c3-pricing-checkout-owned-origin", async () => {
    const pricing = z
      .object({
        plans: z.array(
          z.object({ id: z.string(), credits: z.number(), providers: z.array(z.string()) }),
        ),
      })
      .parse(await (await ok(await anonymous.request("/api/product/pricing"))).json());
    const plan = pricing.plans.find((entry) => entry.id === "starter")!;
    assert.ok(plan.providers.includes("mock"));
    planCredits = plan.credits;
    await denied(
      await anonymous.post("/api/payment/checkout", {
        planId: plan.id,
        provider: "mock",
        locale: "en",
      }),
    );
    await denied(
      await member.post("/api/payment/checkout", {
        planId: plan.id,
        provider: "mock",
        locale: "en",
        returnOrigin: "https://attacker.example.test",
      }),
    );
    await denied(
      await member.post(
        "/api/payment/checkout",
        { planId: plan.id, provider: "mock", locale: "en" },
        { origin: "https://attacker.example.test" },
      ),
    );
    const response = await ok(
      await member.post("/api/payment/checkout", {
        planId: plan.id,
        provider: "mock",
        locale: "en",
      }),
    );
    paymentUrl = new URL(z.object({ url: z.string().url() }).parse(await response.json()).url);
    assert.equal(new URL(paymentUrl.searchParams.get("success")!).origin, targets.public.origin);
    orderId = paymentUrl.searchParams.get("orderId")!;
    assert.ok(orderId);
    const own = z
      .object({ order: z.object({ userId: z.string(), status: z.string() }) })
      .parse(await (await ok(await member.request(`/api/product/order/${orderId}`))).json());
    assert.equal(own.order.userId, memberId);
    assert.equal(own.order.status, "pending");
    assert.equal((await outsider.request(`/api/product/order/${orderId}`)).status, 404);
    await denied(await outsider.request(`/api/payment/mock?${paymentUrl.searchParams}`));
  });
  await check("c3-authenticated-mock-replay-and-owned-ledger", async () => {
    // Browser returns through its own BFF. Backend canonical callback URLs are never rewritten.
    const route = `/api/payment/mock?${paymentUrl.searchParams}`;
    await ok(await member.request(route));
    await denied(
      await outsider.request("/api/payment/mock", {
        method: "POST",
        body: paymentUrl.searchParams,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
    );
    paymentUrl.searchParams.set("userId", "another-user");
    paymentUrl.searchParams.set("planId", "pro");
    paymentUrl.searchParams.set("interval", "year");
    for (const response of await Promise.all(
      Array.from({ length: 4 }, () =>
        member.request("/api/payment/mock", {
          method: "POST",
          body: paymentUrl.searchParams,
          headers: { "content-type": "application/x-www-form-urlencoded" },
        }),
      ),
    )) {
      assert.equal(response.status, 303, await response.clone().text());
      assert.equal(new URL(response.headers.get("location")!).origin, targets.public.origin);
    }
    const after = await creditState(member);
    assert.equal(after.balance, before.balance + planCredits);
    assert.equal(
      after.transactions.filter((entry) => entry.referenceId === `order:${orderId}`).length,
      1,
    );
    const billing = z
      .object({ subscription: z.unknown().nullish() })
      .parse(await (await ok(await member.request("/api/product/billing"))).json());
    assert.ok(billing.subscription == null, "Injected interval must not create a subscription");
    const other = await creditState(outsider, `?userId=${encodeURIComponent(memberId)}`);
    assert.equal(other.balance, otherBefore.balance);
    assert.ok(!other.transactions.some((entry) => entry.userId === memberId));
  });
  await check("c3-admin-api-denial-and-authorized-listing", async () => {
    for (const route of [
      "/api/product/orders",
      "/api/product/credit-transactions",
      "/api/product/referrals",
    ]) {
      await denied(await member.request(route));
      await denied(await anonymous.request(route));
      await ok(await admin.request(route));
    }
    await denied(
      await member.post("/api/product/credit-transactions", {
        email: input.administrator,
        amount: 999,
        reason: "forged",
      }),
    );
    assert.equal((await creditState(member)).balance, before.balance + planCredits);
  });
  await check("c3-referral-capture-origin-and-owned-report", async () => {
    const report = z
      .object({ code: z.string(), origin: z.string().url() })
      .parse(await (await ok(await member.request("/api/product/affiliate"))).json());
    assert.equal(report.origin, targets.public.origin);
    await denied(
      await member.request(`/api/affiliate/capture?code=${report.code}&lang=en`, {
        method: "POST",
      }),
    );
    const capture = await anonymous.request(`/api/affiliate/capture?code=${report.code}&lang=en`, {
      method: "POST",
    });
    assert.equal(capture.status, 303);
    assert.equal(new URL(capture.headers.get("location")!).origin, targets.public.origin);
    assert.ok(
      capture.headers
        .getSetCookie()
        .some((cookie) => /xstack_referral=/.test(cookie) && /HttpOnly/i.test(cookie)),
    );
    const other = z
      .object({ code: z.string() })
      .parse(
        await (
          await ok(await outsider.request(`/api/product/affiliate?userId=${memberId}`))
        ).json(),
      );
    assert.notEqual(other.code, report.code);
  });
}
