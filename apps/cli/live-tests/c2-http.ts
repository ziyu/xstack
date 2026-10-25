import { Database } from "bun:sqlite";
import assert from "node:assert/strict";

import { SQL } from "bun";
import { z } from "zod";

import type { C2Targets } from "./c2-applications";

type AuthBody = {
  name?: string;
  email?: string;
  password?: string;
  callbackURL?: string;
  redirectTo?: string;
  token?: string;
  newPassword?: string;
  userId?: string;
  role?: string;
  banReason?: string;
  action?: string;
  phoneNumber?: string;
  code?: string;
  phoneNumberVerified?: boolean;
  provider?: string;
  disableRedirect?: boolean;
};
const databaseRows = z.array(z.object({ id: z.string().optional(), role: z.string().optional() }));
export type C2Result = {
  name: string;
  status: "passed" | "failed" | "unverified";
  detail?: string;
};
export class C2Database {
  private sqlite?: Database;
  private postgres?: SQL;
  constructor(readonly url: string) {
    if (url.startsWith("file:"))
      this.sqlite = new Database(url.slice(5), { create: false, readwrite: true });
    else this.postgres = new SQL(url, { max: 1, connectionTimeout: 15 });
  }
  async query(text: string, values: (string | number)[] = []) {
    if (this.sqlite) return databaseRows.parse(this.sqlite.query(text).all(...values));
    let parameter = 0;
    return databaseRows.parse(
      await this.postgres!.unsafe(
        text.replace(/\?/g, () => `$${++parameter}`),
        values,
      ),
    );
  }
  async clearLimits() {
    await this.query('DELETE FROM "rate_limit"');
  }
  async expirePhone() {
    await this.query(
      `UPDATE phone_otp_challenge SET expires_at = ${this.sqlite ? "0" : "to_timestamp(0)"}`,
    );
  }
  async ageSession(userId: string, expired = false) {
    const updated = Date.now() - 2 * 86_400_000;
    const expiry = expired ? 0 : Date.now() + 5 * 86_400_000;
    await this.query(
      `UPDATE session SET updated_at = ${this.sqlite ? "?" : "to_timestamp(? / 1000.0)"}, expires_at = ${this.sqlite ? "?" : "to_timestamp(? / 1000.0)"} WHERE user_id = ?`,
      [updated, expiry, userId],
    );
  }
  async close() {
    this.sqlite?.close();
    await this.postgres?.close();
  }
}

class Client {
  readonly cookies = new Map<string, string>();
  constructor(readonly origin: string) {}
  get cookie() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
  async request(path: string, body?: AuthBody, headers: Record<string, string> = {}) {
    const requestHeaders = new Headers({ origin: this.origin, ...headers });
    if (body) requestHeaders.set("content-type", "application/json");
    if (this.cookie) requestHeaders.set("cookie", this.cookie);
    const response = await fetch(this.origin + path, {
      method: body ? "POST" : "GET",
      redirect: "manual",
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(";", 1)[0]!;
      const split = pair.indexOf("=");
      this.cookies.set(pair.slice(0, split), pair.slice(split + 1));
    }
    return response;
  }
  async session() {
    const response = await this.request("/api/auth/get-session");
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()) as {
      user: {
        id: string;
        email: string;
        role: string;
        phoneNumber?: string;
        emailVerified: boolean;
      };
      session: { token: string };
    } | null;
  }
}

export async function exerciseC2(input: {
  targets: C2Targets;
  database: C2Database;
  fixture: string;
  transcript: () => string;
  administrator: string;
  results: C2Result[];
  save: () => Promise<void>;
  signal: AbortSignal;
}) {
  const { targets, database, fixture, transcript, results, save, signal } = input;
  const web = targets.public.origin;
  const adminOrigin = targets.admin.origin;
  const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const email = `member-${stamp}@example.test`;
  const administrator = input.administrator;
  let password = "C2-Real-Password-728!";
  const user = new Client(web);
  const admin = new Client(adminOrigin);
  const anonymous = new Client(web);
  const authPath = (endpoint: string) => `/api/auth/${endpoint}`;
  const token = async (
    origin: string,
    action: string,
    options: { hostname?: string; ageSeconds?: number; success?: boolean } = {},
  ) => {
    const response = await fetch(`${fixture}/issue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, hostname: new URL(origin).hostname, ...options }),
      signal,
    });
    assert.equal(response.status, 200);
    return ((await response.json()) as { token: string }).token;
  };
  const post = async (client: Client, endpoint: string, body: AuthBody, action?: string) => {
    await database.clearLimits();
    return client.request(
      authPath(endpoint),
      body,
      action ? { "x-captcha-token": await token(client.origin, action) } : {},
    );
  };
  const ok = async (response: Response) =>
    assert.equal(response.status, 200, `${response.url}: ${await response.clone().text()}`);
  const denied = async (response: Response) =>
    assert.ok(
      response.status >= 400 && response.status < 500,
      `${response.url}: expected denial, got ${response.status} ${await response.clone().text()}`,
    );
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
  const awaitLog = async (find: (text: string) => string | undefined) => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      const value = find(transcript());
      if (value) return value;
      await Bun.sleep(100);
    }
    throw new Error(
      "The generated integration did not emit its development delivery within 15 seconds",
    );
  };
  const emailLink = (recipient: string, part: string, offset: number) =>
    awaitLog((text) => {
      const delivery = text.slice(offset).split(`[email] to=${recipient} `).slice(1).join("\n");
      // eslint-disable-next-line no-control-regex -- Exclude terminal color escapes from logged URLs.
      return [...delivery.matchAll(/https?:\/\/[^\s<>"\x1b]+/g)]
        .map((match) => match[0])
        .find((url) => url.includes(part));
    });
  const verifyEmail = async (client: Client, recipient: string, offset: number) => {
    const link = new URL(await emailLink(recipient, "/verify-email", offset));
    assert.equal(
      link.origin,
      client.origin,
      "Verification must return through the originating client host",
    );
    const response = await client.request(link.pathname + link.search);
    assert.ok(response.ok || [302, 303, 307, 308].includes(response.status), await response.text());
    return link;
  };
  const login = async (client: Client, recipient: string) =>
    ok(await post(client, "sign-in/email", { email: recipient, password }, "login"));
  const adminList = (client: Client) => client.request("/api/auth/admin/list-users?limit=10");
  let memberId = "";
  let administratorVerification: URL;

  await check("i18n-public-pages-and-anonymous-SSR-denial", async () => {
    const preferred = await anonymous.request("/", undefined, { cookie: "NEXT_LOCALE=zh-CN" });
    assert.ok([302, 303, 307, 308].includes(preferred.status));
    assert.equal(new URL(preferred.headers.get("location")!, web).pathname, "/zh-CN");
    for (const locale of ["en", "zh-CN"]) {
      const response = await anonymous.request(`/${locale}`);
      await ok(response);
      assert.match(await response.text(), /<html/);
    }
    const dashboard = await anonymous.request("/en/dashboard");
    assert.ok([302, 303, 307, 308].includes(dashboard.status));
    assert.match(dashboard.headers.get("location") ?? "", /\/en\/login/);
    await denied(await adminList(anonymous));
  });
  await check("captcha-required-invalid-host-action-time-replay-origin", async () => {
    const body = { name: "C2 Reject", email: `reject-${email}`, password };
    for (const [endpoint, payload] of [
      ["sign-up/email", body],
      ["sign-in/email", { email, password }],
      ["send-verification-email", { email }],
      ["request-password-reset", { email }],
      ["reset-password", { token: "invalid", newPassword: password }],
      ["phone-number/send-otp", { phoneNumber: "+15550000111" }],
    ] as const) {
      const response = await post(anonymous, endpoint, payload);
      await denied(response);
      assert.equal(((await response.json()) as { code: string }).code, "CAPTCHA_REQUIRED");
    }
    for (const [action, options] of [
      ["login", {}],
      ["signup", { hostname: "attacker.example" }],
      ["signup", { ageSeconds: 301 }],
      ["signup", { ageSeconds: -90 }],
      ["signup", { success: false }],
    ] as const) {
      await database.clearLimits();
      const response = await anonymous.request(authPath("sign-up/email"), body, {
        "x-captcha-token": await token(web, action, options),
      });
      await denied(response);
      assert.equal(((await response.json()) as { code: string }).code, "CAPTCHA_INVALID");
    }
    await denied(
      await anonymous.request(authPath("sign-up/email"), body, { "x-captcha-token": "invalid" }),
    );
    const valid = await token(web, "signup");
    await denied(
      await anonymous.request(authPath("sign-up/email"), body, {
        "x-captcha-token": valid,
        origin: "https://attacker.example",
      }),
    );
    await denied(
      await anonymous.request(authPath("sign-up/email"), body, {
        "x-captcha-token": valid,
        origin: "",
      }),
    );
    await database.clearLimits();
    await ok(
      await anonymous.request(authPath("sign-up/email"), body, { "x-captcha-token": valid }),
    );
    await denied(
      await anonymous.request(
        authPath("sign-up/email"),
        { ...body, email: `replayed-${email}` },
        { "x-captcha-token": valid },
      ),
    );
    const rows = await database.query('SELECT id FROM "user" WHERE email = ?', [
      `replayed-${email}`,
    ]);
    assert.equal(rows.length, 0);
    const config = await anonymous.request("/api/captcha/config");
    assert.deepEqual(await config.json(), { siteKey: "captcha-fixture-site" });
  });
  await check("signup-email-hook-verification-login-session-SSR", async () => {
    const offset = transcript().length;
    await ok(
      await post(
        user,
        "sign-up/email",
        { name: `C2 Member ${stamp}`, email, password, callbackURL: `${web}/en/dashboard` },
        "signup",
      ),
    );
    await denied(await post(user, "sign-in/email", { email, password }, "login"));
    await verifyEmail(user, email, offset);
    await login(user, email);
    const session = await user.session();
    assert.equal(session?.user.email, email);
    assert.equal(session?.user.emailVerified, true);
    assert.equal(session?.user.role, "user");
    memberId = session!.user.id;
    const page = await user.request("/en/dashboard");
    await ok(page);
    assert.ok(
      (await page.text()).includes(`C2 Member ${stamp}`),
      "SSR HTML must contain the authenticated user, without browser JavaScript",
    );
    assert.equal(
      (await database.query('SELECT id FROM "user" WHERE email = ?', [email])).length,
      1,
    );
    await denied(await adminList(user));
    const pageClient = new Client(adminOrigin);
    for (const [key, value] of user.cookies) pageClient.cookies.set(key, value);
    assert.ok([403, 404].includes((await pageClient.request("/en/admin")).status));
    if (targets.public.id !== targets.admin.id)
      assert.equal(
        (await user.request("/en/admin")).status,
        404,
        "Frontend must not publish admin pages",
      );
  });
  await check("SSR-session-refresh-propagates-cookie-and-expiry-denies", async () => {
    await database.ageSession(memberId);
    const refreshed = await user.request("/en/dashboard");
    await ok(refreshed);
    assert.ok(
      refreshed.headers.getSetCookie().some((cookie) => cookie.includes("session_token=")),
      "SSR must forward refreshed session Set-Cookie",
    );
    if (targets.public.stack.framework === "next")
      await check("next-RSC-session-refresh-propagates-cookie", async () => {
        await database.ageSession(memberId);
        const navigation = await user.request("/en/dashboard?_rsc", undefined, { RSC: "1" });
        await ok(navigation);
        assert.ok(
          navigation.headers.getSetCookie().some((cookie) => cookie.includes("session_token=")),
          "RSC navigation must relay refreshed cookies",
        );
      });
    await database.ageSession(memberId, true);
    assert.equal(await user.session(), null);
    assert.ok([302, 303, 307, 308].includes((await user.request("/en/dashboard")).status));
    await login(user, email);
  });
  await check("admin-bootstrap-requires-email-verification", async () => {
    const offset = transcript().length;
    await ok(
      await post(
        admin,
        "sign-up/email",
        {
          name: "C2 Administrator",
          email: administrator,
          password,
          callbackURL: `${adminOrigin}/en/admin`,
        },
        "signup",
      ),
    );
    const rows = await database.query('SELECT role FROM "user" WHERE email = ?', [administrator]);
    assert.equal(
      rows[0]?.role,
      "user",
      "Unverified administrator email cannot bootstrap privilege",
    );
    await denied(await post(admin, "sign-in/email", { email: administrator, password }, "login"));
    await denied(await adminList(admin));
    administratorVerification = await verifyEmail(admin, administrator, offset);
    await login(admin, administrator);
    assert.equal((await admin.session())?.user.role, "admin");
    await ok(await adminList(admin));
    await ok(await admin.request("/en/admin"));
  });
  await check("admin-role-mutations-origin-and-stale-privilege-denial", async () => {
    await denied(await post(user, "admin/set-role", { userId: memberId, role: "admin" }));
    await denied(
      await admin.request(
        authPath("admin/set-role"),
        { userId: memberId, role: "admin" },
        { origin: "https://attacker.example" },
      ),
    );
    await ok(await post(admin, "admin/set-role", { userId: memberId, role: "admin" }));
    await login(user, email);
    await ok(await adminList(user));
    const administratorId = (await admin.session())!.user.id;
    await ok(await post(user, "admin/set-role", { userId: administratorId, role: "user" }));
    await admin.request(administratorVerification.pathname + administratorVerification.search);
    assert.equal(
      (await database.query('SELECT role FROM "user" WHERE id = ?', [administratorId]))[0]?.role,
      "user",
      "Verification replay cannot re-promote a demoted admin",
    );
    await ok(await post(user, "admin/set-role", { userId: administratorId, role: "admin" }));
    await denied(
      await admin.request("/api/product/users", { action: "ban", userId: "c2-nonexistent-user" }),
    );
    await ok(await post(admin, "admin/set-role", { userId: memberId, role: "user" }));
    await denied(await adminList(user));
    if (targets.backend.id !== targets.public.id) {
      const backend = await fetch(`${targets.backend.origin}/api/product/admin`, {
        headers: { cookie: user.cookie, "x-xstack-client-origin": web },
      });
      assert.equal(backend.status, 403, "Backend must independently enforce role authorization");
    }
  });
  await check("ban-revokes-existing-session-and-blocks-login", async () => {
    await login(user, email);
    await ok(
      await post(admin, "admin/ban-user", {
        userId: memberId,
        banReason: "C2 disposable acceptance",
      }),
    );
    assert.equal(await user.session(), null);
    await denied(await post(user, "sign-in/email", { email, password }, "login"));
    await ok(await post(admin, "admin/unban-user", { userId: memberId }));
    await login(user, email);
  });
  await check("password-reset-email-hook-token-replay-and-session-revocation", async () => {
    const offset = transcript().length;
    await ok(
      await post(
        user,
        "request-password-reset",
        { email, redirectTo: `${web}/en/reset-password` },
        "password_reset_request",
      ),
    );
    const link = new URL(await emailLink(email, "/reset-password/", offset));
    assert.equal(link.origin, web);
    const redirect = await anonymous.request(link.pathname + link.search);
    assert.ok([302, 303, 307, 308].includes(redirect.status));
    const destination = new URL(redirect.headers.get("location")!, web);
    const resetToken = destination.searchParams.get("token");
    assert.ok(resetToken);
    const newPassword = "C2-New-Password-729!";
    await ok(
      await post(anonymous, "reset-password", { token: resetToken, newPassword }, "password_reset"),
    );
    assert.equal(await user.session(), null);
    await denied(
      await post(anonymous, "reset-password", { token: resetToken, newPassword }, "password_reset"),
    );
    await denied(await post(user, "sign-in/email", { email, password }, "login"));
    password = newPassword;
    await login(user, email);
  });
  await check("session-explicit-revocation-signout-and-cookie-replay", async () => {
    const session = await user.session();
    assert.ok(session);
    const old = new Client(web);
    for (const [key, value] of user.cookies) old.cookies.set(key, value);
    await ok(await post(user, "revoke-session", { token: session.session.token }));
    assert.equal(await old.session(), null);
    await login(user, email);
    old.cookies.clear();
    for (const [key, value] of user.cookies) old.cookies.set(key, value);
    await ok(await post(user, "sign-out", {}));
    assert.equal(await old.session(), null);
    assert.equal(await user.session(), null);
    assert.ok([302, 303, 307, 308].includes((await old.request("/en/dashboard")).status));
  });
  await check("phone-OTP-hook-cooldown-expiry-attempts-concurrency-and-replay", async () => {
    const prefix = `+1555${String(Date.now()).slice(-6)}`;
    const sentCode = (phone: string, offset: number) =>
      awaitLog((text) => {
        const values = [...text.slice(offset).matchAll(/\[sms:console\] (\{[^\n]+\})/g)].map(
          (match) => JSON.parse(match[1]!) as { phoneNumber: string; code: string },
        );
        return values.reverse().find((value) => value.phoneNumber === phone)?.code;
      });
    const send = async (phone: string) => {
      const offset = transcript().length;
      await ok(await post(anonymous, "phone-number/send-otp", { phoneNumber: phone }, "phone_otp"));
      return sentCode(phone, offset);
    };
    const phone = `${prefix}1`;
    const code = await send(phone);
    assert.equal(
      (await post(anonymous, "phone-number/send-otp", { phoneNumber: phone }, "phone_otp")).status,
      429,
    );
    assert.equal(
      (await database.query("SELECT id FROM verification WHERE identifier = ?", [phone])).length,
      0,
      "Plaintext plugin OTP cannot persist",
    );
    await denied(
      await post(anonymous, "phone-number/verify", {
        phoneNumber: phone,
        code: code === "000000" ? "111111" : "000000",
      }),
    );
    await database.clearLimits();
    const phoneClients = [new Client(web), new Client(web)];
    const responses = await Promise.all(
      phoneClients.map((client) =>
        client.request(authPath("phone-number/verify"), { phoneNumber: phone, code }),
      ),
    );
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
    const winner = phoneClients[responses.findIndex((response) => response.status === 200)]!;
    const session = await winner.session();
    assert.equal(session?.user.phoneNumber, phone);
    assert.equal(session?.user.role, "user");
    await denied(await post(anonymous, "phone-number/verify", { phoneNumber: phone, code }));
    const expiredPhone = `${prefix}2`;
    const expiredCode = await send(expiredPhone);
    await database.expirePhone();
    await denied(
      await post(anonymous, "phone-number/verify", {
        phoneNumber: expiredPhone,
        code: expiredCode,
      }),
    );
    const attemptsPhone = `${prefix}3`;
    const attemptsCode = await send(attemptsPhone);
    for (let index = 0; index < 3; index++)
      await denied(
        await post(anonymous, "phone-number/verify", {
          phoneNumber: attemptsPhone,
          code: attemptsCode === "000000" ? "111111" : "000000",
        }),
      );
    await denied(
      await post(anonymous, "phone-number/verify", {
        phoneNumber: attemptsPhone,
        code: attemptsCode,
      }),
    );
    const racePhone = `${prefix}4`;
    await database.clearLimits();
    const sends = await Promise.all(
      [0, 1].map(async () =>
        anonymous.request(
          authPath("phone-number/send-otp"),
          { phoneNumber: racePhone },
          { "x-captcha-token": await token(web, "phone_otp") },
        ),
      ),
    );
    assert.deepEqual(sends.map((response) => response.status).sort(), [200, 429]);
    await denied(
      await post(
        anonymous,
        "sign-up/email",
        {
          name: "Injected Phone",
          email: `injection-${email}`,
          password,
          phoneNumber: `${prefix}5`,
          phoneNumberVerified: true,
        },
        "signup",
      ),
    );
  });
  await check("oauth-authorization-callback-origin-and-invalid-state", async () => {
    for (const provider of ["google", "github", "wechat"]) {
      const client = new Client(web);
      const response = await post(client, "sign-in/social", {
        provider,
        callbackURL: `${web}/en/dashboard`,
        disableRedirect: true,
      });
      await ok(response);
      const authorization = new URL(((await response.json()) as { url: string }).url);
      assert.ok(authorization.searchParams.get("state"));
      assert.equal(
        new URL(authorization.searchParams.get("redirect_uri")!).origin,
        web,
        `${provider} callback belongs to originating client`,
      );
      const before = (await database.query('SELECT id FROM "user"')).length;
      const callback = await client.request(
        `/api/auth/callback/${provider}?code=c2-never-exchange&state=invalid-${stamp}`,
      );
      assert.ok(callback.status >= 300 && callback.status < 500);
      assert.equal(await client.session(), null);
      assert.equal((await database.query('SELECT id FROM "user"')).length, before);
      await denied(
        await post(client, "sign-in/social", {
          provider,
          callbackURL: "https://attacker.example/steal",
          disableRedirect: true,
        }),
      );
    }
  });
  results.push({
    name: "provider-cloud-acceptance",
    status: "unverified",
    detail:
      "OAuth authorization/state boundaries exercised; successful cloud authorization/code exchange NOT exercised. Email/SMS use actual development delivery hooks, not provider delivery. Turnstile uses isolated Siteverify protocol fixture, not Cloudflare attestation.",
  });
  await save();
}
