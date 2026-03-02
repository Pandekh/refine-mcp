/**
 * Refine MCP server — stdio transport for Claude Desktop / Cursor / Copilot.
 * Run via: node bin/refine-mcp.js
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/index";
import { cleanupOldRepos } from "./lib/git/clone";

const server = new McpServer({ name: "refine", version: "1.0.0" });

registerTools(server);

async function main() {
  cleanupOldRepos();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  process.stderr.write("Refine MCP server started\n");
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);

  process.stderr.write(`Fatal: ${msg}\n`);
  process.exit(1);
});
