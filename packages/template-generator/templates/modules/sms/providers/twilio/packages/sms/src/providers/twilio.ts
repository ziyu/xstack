import twilio from "twilio";

import type { Sms } from "../types";

export type ProviderConfig = {
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
};

export function createTransport(env: ProviderConfig): Sms | undefined {
  const {
    TWILIO_ACCOUNT_SID: accountSid,
    TWILIO_AUTH_TOKEN: authToken,
    TWILIO_FROM_NUMBER: from,
  } = env;
  if (
    !accountSid?.trim() ||
    !authToken?.trim() ||
    !from ||
    from.trim() !== from ||
    !/^\+[1-9]\d{1,14}$/.test(from)
  ) {
    return undefined;
  }

  const client = twilio(accountSid, authToken, { autoRetry: false, maxRetries: 0 });

  return {
    async sendOtp({ phoneNumber, code }) {
      try {
        const message = await client.messages.create({
          to: phoneNumber,
          from,
          body: `Your verification code is ${code}. It expires in 5 minutes.`,
          validityPeriod: 300,
        });
        // Accepted/queued is not delivery; reject errors and unexpected outbound states.
        if (
          (message.errorCode != null && message.errorCode !== 0) ||
          (message.status !== "accepted" &&
            message.status !== "queued" &&
            message.status !== "sending" &&
            message.status !== "sent" &&
            message.status !== "delivered")
        ) {
          throw new Error("SMS request rejected");
        }
      } catch {
        throw new Error("Twilio SMS request failed; check the provider console");
      }
    },
  };
}
