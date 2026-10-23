import { z } from "zod";

export type StorageErrorCode = "not_configured" | "invalid_file" | "not_found" | "provider_error";

export class StorageError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StorageError";
  }
}

const remoteFailure = z.object({
  code: z
    .enum([
      "AccessDenied",
      "InvalidAccessKeyId",
      "SignatureDoesNotMatch",
      "SecurityTokenExpired",
      "InvalidSecurityToken",
      "ExpiredToken",
      "NoSuchBucket",
      "NoSuchKey",
      "RequestTimeout",
      "InternalError",
      "ServiceUnavailable",
      "SlowDown",
      "ETIMEDOUT",
      "ECONNRESET",
      "ECONNREFUSED",
      "ENOTFOUND",
      "EAI_AGAIN",
    ])
    .optional()
    .catch(undefined),
  status: z.number().int().min(100).max(599).optional().catch(undefined),
  statusCode: z.number().int().min(100).max(599).optional().catch(undefined),
});

/** SDK errors can contain signed URLs, credentials and request bodies. Keep only safe diagnostics. */
export function safeCause(cause: unknown, operation: string): Error {
  const parsed = remoteFailure.safeParse(cause);
  const code = parsed.success ? parsed.data.code : undefined;
  const status = parsed.success ? (parsed.data.statusCode ?? parsed.data.status) : undefined;
  return new Error(
    `${operation} failed${code ? ` (${code})` : ""}${status ? ` [HTTP ${status}]` : ""}`,
  );
}
