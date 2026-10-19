/**
 * Returns true if telemetry/analytics should be enabled, false otherwise.
 *
 * - DO_NOT_TRACK=1 (the cross-tool convention from consoledonottrack.com) disables analytics.
 * - If XSTACK_TELEMETRY_DISABLED is present and "1", disables analytics.
 * - Otherwise, XSTACK_TELEMETRY: "0" disables, "1" enables (default: enabled).
 */
export function isTelemetryEnabled() {
  const DO_NOT_TRACK = process.env.DO_NOT_TRACK;
  const XSTACK_TELEMETRY_DISABLED = process.env.XSTACK_TELEMETRY_DISABLED;
  const XSTACK_TELEMETRY = process.env.XSTACK_TELEMETRY;

  if (DO_NOT_TRACK === "1" || DO_NOT_TRACK?.toLowerCase() === "true") {
    return false;
  }
  if (XSTACK_TELEMETRY_DISABLED !== undefined) {
    return XSTACK_TELEMETRY_DISABLED !== "1";
  }
  if (XSTACK_TELEMETRY !== undefined) {
    return XSTACK_TELEMETRY === "1";
  }
  // Default: enabled
  return true;
}
