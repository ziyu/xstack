import Dysmsapi, { SendSmsRequest } from "@alicloud/dysmsapi20170525";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import { RetryOptions, RuntimeOptions } from "@darabonba/typescript";

import type { Sms } from "../types";

export type ProviderConfig = {
  ALIYUN_SMS_ACCESS_KEY_ID?: string;
  ALIYUN_SMS_ACCESS_KEY_SECRET?: string;
  ALIYUN_SMS_REGION_ID?: string;
  ALIYUN_SMS_SIGN_NAME?: string;
  ALIYUN_SMS_TEMPLATE_CODE?: string;
};

export function createTransport(env: ProviderConfig): Sms | undefined {
  const {
    ALIYUN_SMS_ACCESS_KEY_ID: accessKeyId,
    ALIYUN_SMS_ACCESS_KEY_SECRET: accessKeySecret,
    ALIYUN_SMS_REGION_ID: regionId,
    ALIYUN_SMS_SIGN_NAME: signName,
    ALIYUN_SMS_TEMPLATE_CODE: templateCode,
  } = env;
  if (
    !accessKeyId?.trim() ||
    !accessKeySecret?.trim() ||
    regionId !== "cn-hangzhou" ||
    !signName?.trim() ||
    !templateCode?.trim()
  ) {
    return undefined;
  }

  const retryOptions = new RetryOptions({ retryable: false });
  const client = new Dysmsapi(
    new $OpenApiUtil.Config({
      accessKeyId,
      accessKeySecret,
      regionId,
      endpoint: "dysmsapi.aliyuncs.com",
      protocol: "HTTPS",
      retryOptions,
    }),
  );
  const runtime = new RuntimeOptions({ autoretry: false, maxAttempts: 1, retryOptions });

  return {
    async sendOtp({ phoneNumber, code }) {
      try {
        const response = await client.sendSmsWithOptions(
          new SendSmsRequest({
            // This API accepts country-code digits; remove only +, never the country code.
            phoneNumbers: phoneNumber.slice(1),
            signName,
            templateCode,
            templateParam: JSON.stringify({ code }),
          }),
          runtime,
        );
        // OK means API acceptance, not confirmed handset delivery.
        if (response.body?.code !== "OK") {
          throw new Error("SMS request rejected");
        }
      } catch {
        // Do not expose SDK messages, causes, phone numbers, or OTPs.
        throw new Error("Alibaba Cloud SMS request failed; check the provider console");
      }
    },
  };
}
