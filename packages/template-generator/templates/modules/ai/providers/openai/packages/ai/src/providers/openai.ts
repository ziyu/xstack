import { z } from "zod";
import { AIError, jsonRequest, type AIProvider } from "../types";

export function openai(env: { OPENAI_API_KEY?: string; OPENAI_CHAT_MODEL?: string; OPENAI_IMAGE_MODEL?: string }): AIProvider | undefined {
  if (!env.OPENAI_API_KEY) return undefined;
  const headers = { Authorization: `Bearer ${env.OPENAI_API_KEY}` };
  return {
    id: "openai",
    models: { chat: env.OPENAI_CHAT_MODEL || "gpt-4.1-mini", image: env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-flare" },
    async generate(input) {
      if (input.kind === "chat") {
        const response = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().min(1) }) })).min(1) }).parse(
          await jsonRequest("https://api.openai.com/v1/chat/completions", headers, { model: input.model, messages: input.messages, max_completion_tokens: 2048, stream: false }),
        );
        return { status: "completed", text: response.choices[0]!.message.content };
      }
      if (input.kind !== "image") throw new AIError("unsupported");
      const response = z.object({ data: z.array(z.object({ b64_json: z.string().min(1) })).min(1) }).parse(
        await jsonRequest("https://api.openai.com/v1/images/generations", headers, { model: input.model, prompt: input.prompt, n: 1, size: "1024x1024", output_format: "png" }),
      );
      return { status: "completed", media: { data: response.data[0]!.b64_json, contentType: "image/png" } };
    },
  };
}
