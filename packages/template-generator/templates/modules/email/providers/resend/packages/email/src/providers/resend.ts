import { Resend } from "resend";

import type { Transport } from "../types";

export type ProviderConfig = {
  RESEND_API_KEY?: string;
};

export function createTransport(env: ProviderConfig): Transport | undefined {
  if (!env.RESEND_API_KEY) return undefined;
  const resend = new Resend(env.RESEND_API_KEY);

  return {
    async send(message) {
      const { error } = await resend.emails.send(message);
      if (error) throw new Error(`Resend: ${error.message}`);
    },
  };
}
