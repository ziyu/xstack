import type { CreateInput } from "../src";
import { c2Cases, c2Input, type C2Case } from "./c2-cases";

export const c3Cases: C2Case[] = c2Cases.map((test) => ({
  ...test,
  id: test.id.startsWith("split-") ? test.id : `fullstack-${test.id}`,
}));

export function c3Input(test: C2Case, projectName: string): CreateInput {
  const input = c2Input(test, projectName);
  return {
    ...input,
    product: {
      ...input.product,
      features: [...input.product!.features!, "payment", "credits", "affiliate"],
      providers: {
        ...input.product!.providers,
        payment: ["stripe", "polar", "wechat", "alipay", "mock"],
      },
    },
  };
}
