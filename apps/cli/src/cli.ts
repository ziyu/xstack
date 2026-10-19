import { lineByLineConsoleLogger } from "trpc-cli";

import { createXStackCli } from "./index";
import { startXStackMcpServer } from "./mcp";

const [, , command, ...args] = process.argv;

if (command === "mcp") {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: xstack mcp

Start the xstack MCP server over stdio.

This command is intended to be launched by an MCP client, for example:
  xstack mcp`);
    process.exit(0);
  }

  await startXStackMcpServer();
} else {
  await createXStackCli().run({ logger: lineByLineConsoleLogger });
}
