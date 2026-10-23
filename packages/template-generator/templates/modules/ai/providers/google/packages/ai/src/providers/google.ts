import { z } from "zod";
import { AIError, jsonRequest, type AIProvider, type Kind, type Result } from "../types";

const part = z.object({ type: z.string(), text: z.string().optional(), data: z.string().optional(), mime_type: z.enum(["image/png", "image/jpeg", "image/webp", "video/mp4"]).optional() });
const interaction = z.object({
  id: z.string().min(1),
  status: z.enum(["in_progress", "completed", "failed", "cancelled", "requires_action"]),
  steps: z.array(z.object({ type: z.string(), content: z.array(part).optional() })).optional(),
});
export function google(env: { GEMINI_API_KEY?: string; GEMINI_CHAT_MODEL?: string; GEMINI_IMAGE_MODEL?: string; GEMINI_VIDEO_MODEL?: string }): AIProvider | undefined {
  if (!env.GEMINI_API_KEY) return undefined;
  const base = "https://generativelanguage.googleapis.com/v1beta/interactions";
  const headers = { "x-goog-api-key": env.GEMINI_API_KEY, "Api-Revision": "2026-05-20" };
  function result(parsed: z.infer<typeof interaction>, kind: Kind): Result {
    if (parsed.status === "in_progress") return { status: "running", remoteId: parsed.id };
    if (parsed.status === "cancelled") return { status: "cancelled" };
    if (parsed.status === "failed") return { status: "failed" };
    if (parsed.status !== "completed") throw new AIError("provider_error");
    const parts = parsed.steps?.filter((step) => step.type === "model_output").flatMap((step) => step.content ?? []) ?? [];
    if (kind === "chat") {
      const text = parts.filter((item) => item.type === "text").map((item) => item.text ?? "").join("");
      if (!text) throw new AIError("provider_error");
      return { status: "completed", text, remoteId: parsed.id };
    }
    const media = parts.find((item) => item.type === kind && item.data && item.mime_type);
    if (!media?.data || !media.mime_type || (kind === "video") !== (media.mime_type === "video/mp4")) throw new AIError("provider_error");
    return { status: "completed", media: { data: media.data, contentType: media.mime_type } };
  }
  return {
    id: "google",
    models: { chat: env.GEMINI_CHAT_MODEL || "gemini-4-argon", image: env.GEMINI_IMAGE_MODEL || "gemini-nano-banana-2.1", video: env.GEMINI_VIDEO_MODEL || "gemini-omni-1.1-flash" },
    async generate(input) {
      return result(interaction.parse(await jsonRequest(base, headers, {
        model: input.model,
        background: input.kind === "video", store: true,
        input: input.prompt,
        previous_interaction_id: input.parentRemoteId || undefined,
        response_format: input.kind === "video" ? { type: "video" } : undefined,
      })), input.kind);
    },
    async poll(remoteId, kind) {
      return result(interaction.parse(await jsonRequest(`${base}/${encodeURIComponent(remoteId)}`, headers)), kind);
    },
    async cancel(remoteId) {
      const response = await fetch(`${base}/${encodeURIComponent(remoteId)}/cancel`, { method: "POST", headers, redirect: "manual", signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new AIError("provider_error");
    },
  };
}
