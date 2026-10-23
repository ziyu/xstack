import { dependencyVersionMap } from "../../utils/add-deps";
import { defineModule } from "../define";
import { NEXT_SHELL_DB } from "./stack";

export default defineModule({
  id: "affiliate",
  name: { en: "Referral credit rewards", "zh-CN": "邀请积分奖励" },
  description: {
    en: "Signed signup attribution and idempotent purchase commissions paid in app credits, not cash",
    "zh-CN": "签名邀请归因与幂等购买奖励，仅发放应用积分，不提供现金提现",
  },
  category: "monetization",
  requires: ["payment", "credits", "auth"],
  enhances: ["admin"],
  supports: NEXT_SHELL_DB,
  options: {
    commissionPercent: {
      type: "number",
      default: 10,
      min: 0,
      max: 100,
      description:
        "Percentage of purchased plan credits rewarded to the inviter; renewals excluded",
    },
    cookieDays: {
      type: "number",
      default: 30,
      min: 1,
      max: 90,
      integer: true,
      description: "First-touch referral cookie lifetime in days",
    },
  },
  packages: [
    {
      dir: "affiliate",
      dependencies: {
        "drizzle-orm": dependencyVersionMap["drizzle-orm"],
        zod: dependencyVersionMap.zod,
      },
      workspaceDependencies: ["db"],
    },
  ],
  appDependencies: { zod: dependencyVersionMap.zod },
  services: [
    {
      name: "affiliate",
      imports: [{ from: "@app/affiliate", names: ["createAffiliate"] }],
      init: "createAffiliate({ db, secret: ENV.BETTER_AUTH_SECRET })",
    },
  ],
  nav: [
    { area: "dashboard", href: "/dashboard/affiliate", labelKey: "nav.affiliate", order: 65 },
    {
      area: "admin",
      href: "/admin/affiliate",
      labelKey: "nav.affiliate",
      order: 45,
      when: "admin",
    },
  ],
});
