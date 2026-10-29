import type { CreateInput } from "../src";
import { c2Cases, c2Input, type C2Case } from "./c2-cases";

export const c4Cases: C2Case[] = c2Cases.map((test) => ({
  ...test,
  id: test.id.startsWith("split-") ? test.id : `fullstack-${test.id}`,
}));

export function c4Input(test: C2Case, projectName: string): CreateInput {
  return {
    ...c2Input(test, projectName),
    product: {
      features: ["core", "i18n", "auth", "admin", "credits", "storage", "ai", "blog", "seo"],
      providers: { auth: [], storage: ["s3"], ai: ["openai", "google", "openai-compatible"] },
    },
  };
}
