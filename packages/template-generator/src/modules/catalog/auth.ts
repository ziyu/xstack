import { defineModule } from "../define";
import { processAuthTemplates } from "../stack/auth";
import { NEXT_SHELL_DB } from "./stack";

export default defineModule({
  id: "auth",
  name: { en: "Authentication", "zh-CN": "用户认证" },
  description: {
    en: "Email and password sign-in, OAuth, roles and account settings",
    "zh-CN": "邮箱密码登录、第三方登录、角色与账户设置",
  },
  category: "identity",
  requires: ["core"],
  enhances: ["email", "sms"],
  supports: NEXT_SHELL_DB,
  domain: {
    field: "auth",
    value: ({ options }) => String(options.engine),
    native: ({ options }) => options.engine === "better-auth",
    stack: { providers: [], render: processAuthTemplates },
  },
  options: {
    engine: {
      type: "enum",
      values: ["better-auth", "clerk"],
      default: "better-auth",
      description: "Clerk is only available through the stack templates",
    },
  },
  providers: {
    min: 0,
    default: { global: ["google", "github"], cn: [] },
    options: {
      google: {
        name: "Google",
        market: "global",
        env: [
          { key: "GOOGLE_CLIENT_ID", required: false, sensitive: false },
          { key: "GOOGLE_CLIENT_SECRET", required: false },
        ],
      },
      github: {
        name: "GitHub",
        market: "global",
        env: [
          { key: "GITHUB_CLIENT_ID", required: false, sensitive: false },
          { key: "GITHUB_CLIENT_SECRET", required: false },
        ],
      },
    },
  },
  packages: [{ dir: "auth", workspaceDependencies: ["db", "events", "i18n"] }],
  env: [
    {
      key: "ADMIN_EMAILS",
      required: false,
      sensitive: false,
      comment: "Comma-separated emails that receive the admin role when they sign up",
    },
  ],
  services: [
    {
      name: "auth",
      imports: [{ from: "@app/auth", names: ["createAuth"] }],
      init: "createAuth(ENV, db, events)",
    },
  ],
  nav: [
    { area: "main", href: "/dashboard", labelKey: "nav.dashboard", order: 90, auth: true },
    { area: "dashboard", href: "/dashboard", labelKey: "nav.overview", order: 0 },
    { area: "dashboard", href: "/dashboard/settings", labelKey: "nav.settings", order: 95 },
  ],
});
