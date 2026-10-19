export function shouldSkipExternalCommands(): boolean {
  return process.env.XSTACK_SKIP_EXTERNAL_COMMANDS === "1" || process.env.XSTACK_TEST_MODE === "1";
}
