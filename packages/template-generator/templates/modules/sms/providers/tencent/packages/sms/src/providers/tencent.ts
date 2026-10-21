import { sms } from "tencentcloud-sdk-nodejs-sms";

import type { Sms } from "../types";

export type ProviderConfig = {
  TENCENT_SMS_SECRET_ID?: string;
  TENCENT_SMS_SECRET_KEY?: string;
  TENCENT_SMS_REGION?: string;
  TENCENT_SMS_SDK_APP_ID?: string;
  TENCENT_SMS_SIGN_NAME?: string;
  TENCENT_SMS_TEMPLATE_ID?: string;
};

export function createTransport(env: ProviderConfig): Sms | undefined {
  const {
    TENCENT_SMS_SECRET_ID: secretId,
    TENCENT_SMS_SECRET_KEY: secretKey,
    TENCENT_SMS_REGION: region,
    TENCENT_SMS_SDK_APP_ID: sdkAppId,
    TENCENT_SMS_SIGN_NAME: signName,
    TENCENT_SMS_TEMPLATE_ID: templateId,
  } = env;
  if (
    !secretId?.trim() ||
    !secretKey?.trim() ||
    !region?.trim() ||
    !sdkAppId?.trim() ||
    !signName?.trim() ||
    !templateId?.trim()
  ) {
    return undefined;
  }

  const client = new sms.v20210111.Client({
    credential: { secretId, secretKey },
    region,
    profile: { httpProfile: { endpoint: "sms.tencentcloudapi.com" } },
  });

  return {
    async sendOtp({ phoneNumber, code }) {
      try {
        // One request only: retrying an ambiguous failure can send duplicate OTPs.
        const response = await client.SendSms({
          PhoneNumberSet: [phoneNumber],
          SmsSdkAppId: sdkAppId,
          SignName: signName,
          TemplateId: templateId,
          TemplateParamSet: [code],
        });
        const statuses = response.SendStatusSet;
        // HTTP success alone is insufficient; check acceptance for the requested recipient.
        if (
          statuses?.length !== 1 ||
          statuses[0]?.Code !== "Ok" ||
          statuses[0]?.PhoneNumber !== phoneNumber
        ) {
          throw new Error("SMS request rejected");
        }
      } catch {
        throw new Error("Tencent Cloud SMS request failed; check the provider console");
      }
    },
  };
}
