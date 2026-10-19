import nodemailer from "nodemailer";

import type { Transport } from "../types";

export type ProviderConfig = {
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_SECURE?: boolean;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
};

export function createTransport(env: ProviderConfig): Transport | undefined {
  if (!env.SMTP_HOST) return undefined;
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: env.SMTP_SECURE ?? false,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });

  return {
    async send(message) {
      await transporter.sendMail(message);
    },
  };
}
