// server.js
//
// Luni MCP server — entry point.
//
// v1 (this file):
//   stdio transport, spawned by Claude Desktop or any local MCP client.
//   Set LUNI_BACKEND_URL + LUNI_JWT in claude_desktop_config.json.
//
// v2 (remote):
//   SSE transport on a Vercel edge function (see remote/vercel-handler.js).
//   auth.js gains the OAuth branch; everything here is unchanged.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ── Personal-finance tools ──────────────────────────────────────────────────
import { listTransactions } from "./tools/list_transactions.js";
import { getBudgetStatus } from "./tools/get_budget_status.js";
import { listSplitsOutstanding } from "./tools/list_splits_outstanding.js";

// ── Business-entity tools (Luni Business / BI layer) ───────────────────────
import { listEntities } from "./tools/list_entities.js";
import { getCashFlow } from "./tools/get_cash_flow.js";
import { getPnl } from "./tools/get_pnl.js";
import { getRecurring } from "./tools/get_recurring.js";
import { getPartnerDistribution } from "./tools/get_partner_distribution.js";

// Registry. To add a tool: write it in tools/, import it above, add here.
const TOOLS = [
  // Personal
  listTransactions,
  getBudgetStatus,
  listSplitsOutstanding,
  // Business
  listEntities,
  getCashFlow,
  getPnl,
  getRecurring,
  getPartnerDistribution,
];

const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

const server = new Server(
  { name: "Luni Financial", version: "0.2.0" },
  { capabilities: { tools: {} } }
);

// Advertise tools to the client.
// annotations tell Claude (and directory reviewers) whether each tool
// reads or writes, and whether it can reach outside Luni's data.
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    // Every Luni tool is read-only, Luni-scoped, non-destructive.
    // Write tools (categorize, create_split, etc.) will carry
    //   readOnlyHint: false  +  a required "confirm": true param.
    annotations: t.annotations ?? {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false, // never crawls the open web
    },
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
    return {
      isError: true,
      content: [{ type: "text", text: err.message ?? String(err) }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

console.error(
  `[luni-mcp] v0.2.0 connected (stdio). backend=${
    process.env.LUNI_BACKEND_URL ?? "http://localhost:3000"
  } tools=${TOOLS.map((t) => t.name).join(",")}`
);
