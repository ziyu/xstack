import type { ProductConfig, ProductPreset } from "@xstack/types";

export const PRODUCT_PRESETS = {
  starter: { features: ["auth"] },
  "saas-global": {
    features: ["auth", "email", "admin", "payment", "credits"],
    providers: { auth: ["google", "github"], email: ["resend"], payment: ["stripe"] },
  },
} satisfies Record<ProductPreset, ProductConfig>;
