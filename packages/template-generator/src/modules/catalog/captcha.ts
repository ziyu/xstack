import { dependencyVersionMap } from "../../utils/add-deps";
import { defineModule } from "../define";
import { NEXT_SHELL_DB } from "./stack";

export default defineModule({
  id: "captcha",
  name: { en: "Bot protection", "zh-CN": "人机验证" },
  description: {
    en: "Turnstile challenges enforced before authentication mutations",
    "zh-CN": "认证操作前强制执行 Turnstile 人机验证",
  },
  category: "identity",
  requires: ["auth"],
  supports: NEXT_SHELL_DB,
  providers: {
    min: 1,
    max: 1,
    default: { global: ["turnstile"], cn: ["turnstile"] },
    options: {
      turnstile: {
        name: "Cloudflare Turnstile",
        market: "any",
        env: [
          { key: "TURNSTILE_SITE_KEY", required: false, sensitive: false },
          { key: "TURNSTILE_SECRET_KEY", required: false },
          {
            key: "TURNSTILE_TEST_MODE",
            required: false,
            type: "boolean",
            default: "false",
            sensitive: false,
            comment:
              "Explicit public dummy keys; allowed only in NODE_ENV=development on loopback origins",
          },
        ],
      },
    },
  },
  packages: [
    {
      dir: "captcha",
      dependencies: {
        "better-auth": dependencyVersionMap["better-auth"],
        zod: dependencyVersionMap.zod,
      },
    },
    { dir: "auth", workspaceDependencies: ["captcha"] },
  ],
  appDependencies: { zod: dependencyVersionMap.zod },
});
