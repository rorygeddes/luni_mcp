// remote/vercel-handler.js
//
// v2 transport skeleton — NOT active yet.
//
// When you're ready to ship the connector publicly:
//
//   1. Deploy this as a Vercel Edge Function at api/mcp.js (or via vercel.json routing).
//   2. Set env vars on Vercel:
//        LUNI_BACKEND_URL  = https://api.luni.ca
//        LUNI_OAUTH_EXCHANGE_URL = https://api.luni.ca/oauth/token-exchange
//   3. Add the OAuth provider routes to backend/server.js:
//        GET  /oauth/authorize          — redirect to Luni login, return code
//        POST /oauth/token              — exchange code for short-lived JWT
//        POST /oauth/token-exchange     — trade MCP bearer token for Supabase JWT
//        GET  /.well-known/oauth-authorization-server  — MCP OAuth metadata
//   4. In claude_desktop_config.json (custom connector mode):
//        URL: https://mcp.luni.ca/sse
//        OAuth Client ID: <your Luni OAuth client>
//   5. When submitting to the Anthropic connector directory:
//        — confirm readOnlyHint: true is on every tool (already done in server.js)
//        — allowlist these redirect URIs in your OAuth config:
//            https://claude.ai/api/mcp/auth_callback
//            https://claude.com/api/mcp/auth_callback
//
// The tool files (tools/*.js) are completely unchanged between stdio and SSE.
// Only the transport and auth resolution differ.

// ─── Imports ─────────────────────────────────────────────────────────────────

// TODO: swap StdioServerTransport → SSEServerTransport when this goes live.
// import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

// ─── Edge function handler ────────────────────────────────────────────────────

/**
 * Vercel Edge Function entry point.
 *
 * GET  /api/mcp  — SSE stream (Claude connects here, keeps connection open)
 * POST /api/mcp  — Message endpoint (Claude posts tool calls here)
 *
 * The MCP SDK's SSEServerTransport handles the protocol framing;
 * server.js tools are wired in exactly as they are in stdio mode.
 */
export default async function handler(req) {
  // TODO: implement when switching to SSE transport.
  // Rough shape:
  //
  // const transport = new SSEServerTransport("/api/mcp", res);
  // await server.connect(transport);
  //
  // server is the same Server instance from server.js, but server.js
  // currently does `await server.connect(stdioTransport)` at module level.
  // Refactor server.js to export `createServer()` and call connect()
  // from here instead.

  return new Response("Luni MCP remote transport — not yet active.", {
    status: 503,
    headers: { "Content-Type": "text/plain" },
  });
}

// ─── OAuth endpoints (add to backend/server.js, not here) ───────────────────
//
// These live in your Express backend, not in this Vercel function.
// This comment block is a checklist, not runnable code.
//
// router.get("/.well-known/oauth-authorization-server", (req, res) => {
//   res.json({
//     issuer: "https://api.luni.ca",
//     authorization_endpoint: "https://api.luni.ca/oauth/authorize",
//     token_endpoint: "https://api.luni.ca/oauth/token",
//     scopes_supported: ["luni:entities:read", "luni:transactions:read"],
//     response_types_supported: ["code"],
//     code_challenge_methods_supported: ["S256"],  // PKCE required
//   });
// });
//
// router.get("/oauth/authorize", async (req, res) => { ... });
// router.post("/oauth/token",    async (req, res) => { ... });
// router.post("/oauth/token-exchange", async (req, res) => { ... });
