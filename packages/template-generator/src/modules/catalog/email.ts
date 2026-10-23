import { defineModule } from "../define";
import { NEXT_SHELL } from "./stack";

export default defineModule({
  id: "email",
  name: { en: "Email", "zh-CN": "邮件" },
  description: {
    en: "Transactional email with swappable providers; sends auth emails",
    "zh-CN": "可切换服务商的事务邮件，负责发送认证相关邮件",
  },
  category: "communication",
  requires: ["core"],
  enhances: ["auth"],
  supports: NEXT_SHELL,
  providers: {
    min: 1,
    max: 1,
    default: { global: ["resend"], cn: ["smtp"] },
    targetDefaults: { cloudflare: ["resend"] },
    options: {
      resend: {
        name: "Resend",
        market: "global",
        dependencies: { resend: "^6.32.0" },
        env: [{ key: "RESEND_API_KEY", required: false }],
      },
      smtp: {
        name: "SMTP",
        market: "any",
        supports: { targets: ["none", "node", "vercel", "docker"] },
        dependencies: { nodemailer: "^10.0.13" },
        devDependencies: { "@types/nodemailer": "^8.0.2" },
        env: [
          { key: "SMTP_HOST", required: false, sensitive: false, example: "smtp.example.com" },
          { key: "SMTP_PORT", required: false, sensitive: false, type: "number", default: "587" },
          {
            key: "SMTP_SECURE",
            required: false,
            sensitive: false,
            type: "boolean",
            default: "false",
          },
          { key: "SMTP_USER", required: false, sensitive: false },
          { key: "SMTP_PASSWORD", required: false },
        ],
      },
    },
  },
  packages: [{ dir: "email" }],
  env: [
    {
      key: "EMAIL_FROM",
      sensitive: false,
      example: '"Acme <onboarding@resend.dev>"',
      comment: "Sender shown in outgoing emails",
    },
  ],
  services: [
    {
      name: "mailer",
      imports: [{ from: "@app/email", names: ["createMailer"] }],
      init: "createMailer(ENV)",
    },
  ],
});
