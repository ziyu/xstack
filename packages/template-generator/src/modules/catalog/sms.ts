import { dependencyVersionMap } from "../../utils/add-deps";
import { defineModule } from "../define";
import { NEXT_SHELL_DB } from "./stack";

export default defineModule({
  id: "sms",
  name: { en: "SMS", "zh-CN": "短信" },
  description: {
    en: "Verification SMS with Alibaba Cloud, Tencent Cloud, or Twilio",
    "zh-CN": "通过阿里云、腾讯云或 Twilio 发送短信验证码",
  },
  category: "communication",
  requires: ["core"],
  enhances: ["auth"],
  supports: NEXT_SHELL_DB,
  providers: {
    min: 1,
    max: 1,
    default: { global: ["aliyun"], cn: ["aliyun"] },
    targetDefaults: { cloudflare: ["twilio"] },
    options: {
      aliyun: {
        name: "Alibaba Cloud SMS",
        market: "cn",
        supports: { targets: ["none", "node", "vercel", "docker"] },
        dependencies: {
          "@alicloud/dysmsapi20170525": "4.6.0",
          "@alicloud/openapi-core": "1.0.8",
          "@darabonba/typescript": "1.0.5",
        },
        env: [
          { key: "ALIYUN_SMS_ACCESS_KEY_ID", required: false },
          { key: "ALIYUN_SMS_ACCESS_KEY_SECRET", required: false },
          {
            key: "ALIYUN_SMS_REGION_ID",
            required: false,
            sensitive: false,
            default: "cn-hangzhou",
          },
          { key: "ALIYUN_SMS_SIGN_NAME", required: false, sensitive: false },
          { key: "ALIYUN_SMS_TEMPLATE_CODE", required: false, sensitive: false },
        ],
      },
      tencent: {
        name: "Tencent Cloud SMS",
        market: "cn",
        supports: { targets: ["none", "node", "vercel", "docker"] },
        dependencies: { "tencentcloud-sdk-nodejs-sms": "4.1.306" },
        env: [
          { key: "TENCENT_SMS_SECRET_ID", required: false },
          { key: "TENCENT_SMS_SECRET_KEY", required: false },
          {
            key: "TENCENT_SMS_REGION",
            required: false,
            sensitive: false,
            default: "ap-guangzhou",
          },
          { key: "TENCENT_SMS_SDK_APP_ID", required: false, sensitive: false },
          { key: "TENCENT_SMS_SIGN_NAME", required: false, sensitive: false },
          { key: "TENCENT_SMS_TEMPLATE_ID", required: false, sensitive: false },
        ],
      },
      twilio: {
        name: "Twilio",
        market: "global",
        dependencies: { zod: dependencyVersionMap.zod },
        env: [
          { key: "TWILIO_ACCOUNT_SID", required: false },
          { key: "TWILIO_AUTH_TOKEN", required: false },
          { key: "TWILIO_FROM_NUMBER", required: false, sensitive: false },
        ],
      },
    },
  },
  packages: [{ dir: "sms" }],
  env: [
    {
      key: "SMS_DELIVERY_MODE",
      type: "enum",
      values: ["provider", "console"],
      default: "provider",
      sensitive: false,
      comment: "console prints OTPs only when NODE_ENV=development; never a fallback",
    },
  ],
  services: [
    {
      name: "sms",
      imports: [{ from: "@app/sms", names: ["createSms"] }],
      init: "createSms(ENV)",
    },
  ],
});
