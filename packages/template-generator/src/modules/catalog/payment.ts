import { dependencyVersionMap } from "../../utils/add-deps";
import { defineModule } from "../define";
import { NEXT_SHELL_DB } from "./stack";

export default defineModule({
  id: "payment",
  name: { en: "Payments", "zh-CN": "支付" },
  description: {
    en: "Pricing page, one-time payments and subscriptions with provider webhooks",
    "zh-CN": "定价页、一次性支付与订阅，处理服务商 webhook",
  },
  category: "monetization",
  requires: ["auth"],
  enhances: ["admin"],
  supports: NEXT_SHELL_DB,
  providers: {
    min: 1,
    default: { global: ["stripe"], cn: [] },
    options: {
      stripe: {
        name: "Stripe",
        market: "global",
        dependencies: { stripe: "^23.0.0" },
        env: [
          { key: "STRIPE_SECRET_KEY", required: false },
          { key: "STRIPE_WEBHOOK_SECRET", required: false },
        ],
      },
      mock: {
        name: "Mock (development only)",
        market: "any",
      },
      polar: {
        name: "Polar",
        market: "global",
        dependencies: { "@polar-sh/sdk": "^1.0.2" },
        env: [
          { key: "POLAR_ACCESS_TOKEN", required: false },
          { key: "POLAR_WEBHOOK_SECRET", required: false },
          {
            key: "POLAR_SERVER",
            required: false,
            sensitive: false,
            type: "enum",
            values: ["sandbox", "production"],
            default: "sandbox",
          },
        ],
      },
    },
  },
  packages: [
    {
      dir: "payment",
      dependencies: { "drizzle-orm": dependencyVersionMap["drizzle-orm"] },
      workspaceDependencies: ["db", "events"],
    },
  ],
  services: [
    {
      name: "payment",
      imports: [{ from: "@app/payment", names: ["createPayment"] }],
      init: "createPayment({ env: ENV, db, events, baseUrl: ENV.BETTER_AUTH_URL })",
    },
  ],
  nav: [
    { area: "main", href: "/pricing", labelKey: "nav.pricing", order: 20 },
    { area: "dashboard", href: "/dashboard/billing", labelKey: "nav.billing", order: 50 },
    { area: "admin", href: "/admin/orders", labelKey: "nav.orders", order: 20, when: "admin" },
  ],
});
