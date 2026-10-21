import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { resolve, sep } from "node:path";

/** Exercise an already-running generated development app with SMS_DELIVERY_MODE=console.
 * Pass its root directory, origin and the server log path. Never point this at production.
 */
const [projectDirectory, origin, logPath] = process.argv.slice(2);
if (!projectDirectory || !origin || !logPath)
  throw new Error(
    "Usage: bun apps/cli/live-tests/phone.ts <generated-project> <origin> <console-log>",
  );
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw new Error("Only a disposable loopback app is allowed");
const disposableRoot = resolve(import.meta.dir, "../.smoke") + sep;
if (!resolve(projectDirectory).startsWith(disposableRoot))
  throw new Error(
    "The fixture must be under apps/cli/.smoke; this test expires OTPs and resets rate limits",
  );
const database = new Database(`${projectDirectory}/local.db`, { create: false, readwrite: true });
const cookies: string[] = [];

async function request(endpoint: string, body: Record<string, unknown>, cookie?: string) {
  return fetch(`${origin}/api/auth/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}
async function sentCode(phoneNumber: string) {
  const lines = (await Bun.file(logPath).text()).split("\n");
  const matches = lines.flatMap((line) => {
    const marker = line.indexOf("[sms:console] ");
    if (marker < 0) return [];
    const message = JSON.parse(line.slice(marker + "[sms:console] ".length));
    return message.phoneNumber === phoneNumber ? [message.code as string] : [];
  });
  assert.ok(matches.length, "The explicit development transport emitted an OTP");
  return matches.at(-1)!;
}
const prefix = `+1555${String(Date.now()).slice(-6)}`;
const phone = `${prefix}1`;
try {
  database.exec("DELETE FROM rate_limit");
  assert.equal((await request("phone-number/send-otp", { phoneNumber: "123" })).status, 400);
  const send = await request("phone-number/send-otp", { phoneNumber: phone });
  assert.equal(send.status, 200, await send.text());
  const code = await sentCode(phone);
  assert.equal((await request("phone-number/send-otp", { phoneNumber: phone })).status, 429);
  const wrong = code === "000000" ? "111111" : "000000";
  const pendingVerification = database
    .query("SELECT count(*) AS count FROM verification WHERE identifier = ?")
    .get(phone) as { count: number };
  assert.equal(pendingVerification.count, 0, "No plaintext plugin OTP persists");
  assert.equal(
    (await request("phone-number/verify", { phoneNumber: phone, code: wrong })).status,
    400,
  );
  const results = await Promise.all(
    [0, 1].map(() => request("phone-number/verify", { phoneNumber: phone, code })),
  );
  assert.equal(
    results.filter((r) => r.status === 200).length,
    1,
    "Exactly one concurrent redemption succeeds",
  );
  const success = results.find((r) => r.status === 200)!;
  for (const cookie of success.headers.getSetCookie()) cookies.push(cookie.split(";")[0]!);
  const session = await fetch(`${origin}/api/auth/get-session`, {
    headers: { cookie: cookies.join("; ") },
  });
  const sessionData = await session.json();
  assert.equal(sessionData.user.phoneNumber, phone);
  assert.equal(sessionData.user.phoneNumberVerified, true);
  assert.equal(sessionData.user.role, "user");
  assert.ok(sessionData.user.email.endsWith("@phone.invalid"));
  assert.equal(
    (await request("phone-number/verify", { phoneNumber: phone, code })).status,
    400,
    "Consumed OTP cannot be replayed",
  );
  const users = database
    .query("SELECT count(*) AS count FROM user WHERE phone_number = ?")
    .get(phone) as { count: number };
  assert.equal(users.count, 1);
  database.exec("DELETE FROM rate_limit");
  const attemptPhone = `${prefix}2`;
  assert.equal((await request("phone-number/send-otp", { phoneNumber: attemptPhone })).status, 200);
  const attemptCode = await sentCode(attemptPhone);
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.equal(
      (
        await request("phone-number/verify", {
          phoneNumber: attemptPhone,
          code: attemptCode === "000000" ? "111111" : "000000",
        })
      ).status,
      400,
    );
  }
  assert.equal(
    (await request("phone-number/verify", { phoneNumber: attemptPhone, code: attemptCode })).status,
    400,
    "Correct code is rejected after attempt exhaustion",
  );
  database.exec("DELETE FROM rate_limit");
  const expiredPhone = `${prefix}3`;
  assert.equal((await request("phone-number/send-otp", { phoneNumber: expiredPhone })).status, 200);
  const expiredCode = await sentCode(expiredPhone);
  database.exec("UPDATE phone_otp_challenge SET expires_at = 0");
  assert.equal(
    (await request("phone-number/verify", { phoneNumber: expiredPhone, code: expiredCode })).status,
    400,
    "Expired OTP is rejected",
  );
  database.exec("DELETE FROM rate_limit");
  const concurrentPhone = `${prefix}4`;
  const sends = await Promise.all(
    [0, 1].map(() => request("phone-number/send-otp", { phoneNumber: concurrentPhone })),
  );
  assert.deepEqual(
    sends.map((response) => response.status).sort(),
    [200, 429],
    "Only one concurrent send is admitted",
  );
  assert.equal(
    (
      await request(
        "phone-number/verify",
        {
          phoneNumber: concurrentPhone,
          code: await sentCode(concurrentPhone),
          updatePhoneNumber: true,
        },
        cookies.join("; "),
      )
    ).status,
    400,
    "Linking cannot bypass signup/login-only boundary",
  );
  database.exec("DELETE FROM rate_limit");
  const protectedPhone = `${prefix}5`;
  const emailSignup = await request("sign-up/email", {
    name: "Email User",
    email: `phone-smoke-${Date.now()}@example.test`,
    password: "Phone-Smoke-Password-123!",
    phoneNumber: protectedPhone,
    phoneNumberVerified: true,
  });
  assert.equal(emailSignup.status, 400, await emailSignup.text());
  const claimed = database
    .query("SELECT count(*) AS count FROM user WHERE phone_number = ?")
    .get(protectedPhone) as { count: number };
  assert.equal(claimed.count, 0, "Email signup cannot claim an unverified phone");
  console.log(
    "Phone signup, session, cooldown, expiry, attempt exhaustion, concurrent send/redemption, replay rejection and unverified phone protection passed.",
  );
} finally {
  database.close();
}
