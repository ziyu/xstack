import { z } from "zod";
import { AIError, jsonRequest, type AIProvider } from "../types";

export function compatible(env: { AI_COMPATIBLE_API_KEY?: string; AI_COMPATIBLE_BASE_URL?: string; AI_COMPATIBLE_CHAT_MODEL?: string }): AIProvider | undefined {
  if (!env.AI_COMPATIBLE_API_KEY) return undefined;
  // This server-only endpoint is operator configuration, never request input.
  const endpoint = new URL(z.string().url().parse(env.AI_COMPATIBLE_BASE_URL || "https://api.deepseek.com"));
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new AIError("not_configured");
  return {
    id: "openai-compatible", models: { chat: env.AI_COMPATIBLE_CHAT_MODEL || "deepseek-flash" },
    async generate(input) {
      if (input.kind !== "chat") throw new AIError("unsupported");
      const response = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().min(1) }) })).min(1) }).parse(await jsonRequest(
        `${endpoint.href.replace(/\/$/, "")}/chat/completions`, { Authorization: `Bearer ${env.AI_COMPATIBLE_API_KEY}` },
        { model: input.model, messages: input.messages, max_tokens: 2048, stream: false },
      ));
      return { status: "completed", text: response.choices[0]!.message.content };
    },
  };
}
