import type { ProductConfig, ProductPreset } from "@xstack/types";

export const PRODUCT_PRESETS = {
  starter: { features: ["auth"] },
  "saas-global": {
    features: ["auth", "email", "admin", "payment", "credits"],
    providers: { auth: ["google", "github"], email: ["resend"], payment: ["stripe"] },
  },
  full: {
    features: [
      "auth",
      "email",
      "sms",
      "admin",
      "payment",
      "credits",
      "storage",
      "ai",
      "seo",
      "blog",
      "affiliate",
      "captcha",
    ],
    providers: {
      auth: ["google", "github"],
      email: ["resend"],
      sms: ["twilio"],
      payment: ["stripe"],
      storage: ["s3"],
      ai: ["openai", "google", "openai-compatible"],
      captcha: ["turnstile"],
    },
  },
} satisfies Record<ProductPreset, ProductConfig>;
