import { z } from "zod";

export const kindSchema = z.enum(["chat", "image", "video"]);
export type Kind = z.infer<typeof kindSchema>;
export const requestSchema = z.object({
  requestId: z.string().uuid(), provider: z.string().min(1).max(40), kind: kindSchema,
  prompt: z.string().trim().min(1).max(8000), parentId: z.string().uuid().optional(),
}).strict();
export type GenerationRequest = z.infer<typeof requestSchema>;
export type Message = { role: "user" | "assistant"; content: string };
export type Result =
  | { status: "running"; remoteId: string }
  | { status: "completed"; text: string; remoteId?: string }
  | { status: "completed"; media: { data: string; contentType: "image/png" | "image/jpeg" | "image/webp" | "video/mp4" } }
  | { status: "failed" }
  | { status: "cancelled" };
export interface AIProvider {
  id: string;
  models: Partial<Record<Kind, string>>;
  generate(input: { kind: Kind; model: string; prompt: string; messages: Message[]; requestId: string; parentRemoteId?: string }): Promise<Result>;
  poll?(remoteId: string, kind: Kind): Promise<Result>;
  cancel?(remoteId: string): Promise<void>;
}
export class ProviderRejected extends Error {}
export class AIError extends Error {
  constructor(readonly code: "invalid_request" | "not_configured" | "unsupported" | "not_found" | "conflict" | "insufficient_credits" | "provider_error" | "busy") { super(code); }
}
// Leaves headroom for JSON text, parsed base64 and decoded bytes on Workers.
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
export function decodeMedia(data: string): Uint8Array<ArrayBuffer> {
  if (!data || data.length > Math.ceil(MAX_MEDIA_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new AIError("provider_error");
  const decoded = atob(data);
  if (decoded.length > MAX_MEDIA_BYTES) throw new AIError("provider_error");
  return Uint8Array.from(decoded, (value) => value.charCodeAt(0));
}
type Json = string | number | boolean | null | Json[] | { [key: string]: Json | undefined };
export async function jsonRequest(url: string, headers: Record<string, string>, body?: Json, method = body === undefined ? "GET" : "POST"): Promise<unknown> {
  const init: RequestInit = { method, headers: { ...headers, "Content-Type": "application/json" }, redirect: "manual", signal: AbortSignal.timeout(120_000) };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(url, init);
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500 && response.status !== 408) throw new ProviderRejected("Provider rejected generation");
    throw new AIError("provider_error");
  }
  if (!response.body) throw new AIError("provider_error");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 12 * 1024 * 1024) { await reader.cancel(); throw new AIError("provider_error"); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  return JSON.parse(text);
}
