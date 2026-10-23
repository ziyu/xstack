import { z } from "zod";

import type { Sms } from "../types";

export type ProviderConfig = {
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
};
const configuration = z.object({
  accountSid: z.string().regex(/^AC[a-fA-F0-9]{32}$/),
  authToken: z.string().regex(/^[a-fA-F0-9]{32}$/),
  from: z.string().regex(/^\+[1-9]\d{1,14}$/),
});
const messageResult = z.object({
  sid: z.string().min(1),
  status: z.enum(["accepted", "queued", "sending", "sent", "delivered"]),
  error_code: z.number().nullable().optional(),
});

export function createTransport(env: ProviderConfig): Sms | undefined {
  const parsed = configuration.safeParse({
    accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, from: env.TWILIO_FROM_NUMBER,
  });
  if (!parsed.success) return undefined;
  const { accountSid, authToken, from } = parsed.data;
  return {
    async sendOtp({ phoneNumber, code }) {
      try {
        const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
          method: "POST",
          headers: {
            authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: phoneNumber, From: from,
            Body: `Your verification code is ${code}. It expires in 5 minutes.`,
            ValidityPeriod: "300",
          }),
          redirect: "manual",
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error("SMS request rejected");
        const message = messageResult.parse(await response.json());
        if (message.error_code != null && message.error_code !== 0) throw new Error("SMS request rejected");
      } catch {
        // Never automatically retry a paid send with an ambiguous network outcome.
        throw new Error("Twilio SMS request failed; check the provider console");
      }
    },
  };
}
