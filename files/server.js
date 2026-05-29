// server.js
//
// Luni MCP server entry point.
//
// Local mode (v1, this file):
//   - Started by Claude Desktop as a subprocess via stdio.
//   - Reads LUNI_BACKEND_URL and LUNI_JWT from env (set in
//     claude_desktop_config.json).
//   - All tool calls forward to your existing Express backend with the
//     user's Supabase JWT, so RLS and verifyToken keep enforcing access.
//
// Remote mode (v2, future):
//   - Same tools, but transport becomes HTTP+SSE on a Vercel function.
//   - auth.js gains an OAuth branch; everything else here is unchanged.
//
// Run locally to smoke-test:
//   LUNI_BACKEND_URL=http://localhost:3000 LUNI_JWT=eyJ... node server.js
// (then talk to it over stdin/stdout if you want, but normally Claude
// Desktop spawns it for you.)

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { listTransactions } from "./tools/list_transactions.js";
import { getBudgetStatus } from "./tools/get_budget_status.js";
import { listSplitsOutstanding } from "./tools/list_splits_outstanding.js";

// Registry — to add a new tool, write the file in tools/ and add it here.
const TOOLS = [listTransactions, getBudgetStatus, listSplitsOutstanding];
const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

const server = new Server(
  {
    name: "luni",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Advertise tools to Claude.
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

// Dispatch tool calls.
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args } = request.params;
  const tool = TOOL_BY_NAME[name];
  if (!tool) {
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
    };
  }
  try {
    return await tool.handler(args ?? {}, extra);
  } catch (err) {
    // Last-resort error wrapping — individual tools usually handle their
    // own errors, this catches things like a missing JWT from auth.js.
    return {
      isError: true,
      content: [{ type: "text", text: err.message ?? String(err) }],
    };
  }
});

// Start.
const transport = new StdioServerTransport();
await server.connect(transport);

// Useful breadcrumb in Claude Desktop logs — stderr, not stdout (stdout
// is the MCP wire protocol).
console.error(
  `[luni-mcp] connected over stdio. backend=${
    process.env.LUNI_BACKEND_URL ?? "http://localhost:3000"
  } tools=${TOOLS.map((t) => t.name).join(",")}`
);
