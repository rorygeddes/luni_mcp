// dev/local-server.js
//
// Local MCP + Skybridge DevTools for testing Luni tools in the browser.
//   DevTools UI:  http://localhost:3000/
//   MCP endpoint: http://localhost:3000/mcp
//
// Requires env (use --env-file or export):
//   SUPABASE_URL, SUPABASE_ANON_KEY, LUNI_JWT

import express from "express";
import { devtoolsStaticServer } from "@skybridge/devtools";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { listTransactions } from "../tools/list_transactions.js";
import { getBudgetStatus } from "../tools/get_budget_status.js";
import { listSplitsOutstanding } from "../tools/list_splits_outstanding.js";
import { listEntities } from "../tools/list_entities.js";
import { getCashFlow } from "../tools/get_cash_flow.js";
import { getPnl } from "../tools/get_pnl.js";
import { getRecurring } from "../tools/get_recurring.js";
import { getPartnerDistribution } from "../tools/get_partner_distribution.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const TOOLS = [
  listTransactions,
  getBudgetStatus,
  listSplitsOutstanding,
  listEntities,
  getCashFlow,
  getPnl,
  getRecurring,
  getPartnerDistribution,
];
const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

function buildMcpServer() {
  const server = new Server(
    { name: "Luni Financial", version: "0.3.0-dev" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations ?? {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    const tool = TOOL_BY_NAME[name];
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
      };
    }

    const jwt = process.env.LUNI_JWT?.trim();
    const enrichedExtra = jwt ? { ...extra, resolvedJwt: jwt } : extra;

    try {
      return await tool.handler(args ?? {}, enrichedExtra);
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message ?? String(err) }],
      };
    }
  });

  return server;
}

const app = express();
app.use(express.json());

app.use(await devtoolsStaticServer());

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    version: "0.3.0-dev",
    tools: TOOLS.map((t) => t.name),
    hasJwt: Boolean(process.env.LUNI_JWT?.trim()),
  });
});

app.all("/mcp", async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
    return;
  }

  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => transport.close());

  try {
    await server.connect(transport);
    req.url = req.originalUrl;
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[luni-mcp dev] MCP error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  } finally {
    await server.close().catch(() => {});
  }
});

app.listen(PORT, () => {
  console.log(`\n[luni-mcp dev] Skybridge DevTools → http://localhost:${PORT}/`);
  console.log(`[luni-mcp dev] MCP endpoint      → http://localhost:${PORT}/mcp`);
  console.log(
    `[luni-mcp dev] JWT: ${process.env.LUNI_JWT?.trim() ? "set" : "MISSING — set LUNI_JWT in env"}`
  );
  console.log(
    `[luni-mcp dev] Tools: ${TOOLS.map((t) => t.name).join(", ")}\n`
  );
});
