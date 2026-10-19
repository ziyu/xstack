import { dependencyVersionMap } from "../../utils/add-deps";
import { defineModule } from "../define";
import { NEXT_SHELL_DB } from "./stack";

export default defineModule({
  id: "credits",
  name: { en: "Credits", "zh-CN": "积分" },
  description: {
    en: "Usage credits with an auditable ledger; granted by purchases and sign-up bonuses",
    "zh-CN": "可审计流水的积分体系，可由购买和注册赠送获得",
  },
  category: "monetization",
  requires: ["auth"],
  enhances: ["payment", "admin"],
  supports: NEXT_SHELL_DB,
  options: {
    signupBonus: {
      type: "number",
      default: 0,
      min: 0,
      description: "Credits granted to every new account",
    },
  },
  packages: [
    {
      dir: "credits",
      dependencies: { "drizzle-orm": dependencyVersionMap["drizzle-orm"] },
      workspaceDependencies: ["db", "events"],
    },
  ],
  services: [
    {
      name: "credits",
      imports: [{ from: "@app/credits", names: ["createCredits"] }],
      init: "createCredits(db, events)",
    },
  ],
  nav: [
    { area: "dashboard", href: "/dashboard/credits", labelKey: "nav.credits", order: 40 },
    { area: "admin", href: "/admin/credits", labelKey: "nav.credits", order: 30, when: "admin" },
  ],
});
