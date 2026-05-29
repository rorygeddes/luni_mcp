// remote/server.js
//
// Luni MCP remote server — Express + StreamableHTTP + OAuth 2.1
//
// Users add this to Claude via Settings → Integrations → Add custom integration.
// They paste the MCP URL (e.g. https://mcp.luni.ca/mcp).
// Claude discovers OAuth metadata at /.well-known/oauth-authorization-server,
// redirects the user to /oauth/authorize to sign in with their Luni account,
// then sends a Bearer token on every tool call.
// Each call resolves to a fresh Supabase JWT so RLS enforces per-user isolation.
//
// Env vars required (set on your hosting platform):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   SUPABASE_ANON_KEY
//   LUNI_BACKEND_URL    (e.g. https://api.luni.ca)
//   MCP_SERVER_URL      (e.g. https://mcp.luni.ca)  — used for OAuth issuerUrl
//   PORT                (optional, defaults to 3001)

import express from 'express';
import { randomUUID } from 'crypto';

import { Server }                             from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport }      from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter }                      from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth }                  from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { LuniOAuthProvider, handleLoginSubmit, handleGoogleComplete, getSupabaseJwtForMcpToken }
  from './oauth-provider.js';

// ── Tool registry (same files as stdio server — no duplication) ───────────────
import { listTransactions }     from '../tools/list_transactions.js';
import { getBudgetStatus }      from '../tools/get_budget_status.js';
import { listSplitsOutstanding} from '../tools/list_splits_outstanding.js';
import { listEntities }         from '../tools/list_entities.js';
import { getCashFlow }          from '../tools/get_cash_flow.js';
import { getPnl }               from '../tools/get_pnl.js';
import { getRecurring }         from '../tools/get_recurring.js';
import { getPartnerDistribution}from '../tools/get_partner_distribution.js';

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

const TOOL_BY_NAME = Object.fromEntries(TOOLS.map(t => [t.name, t]));

// ── Config ────────────────────────────────────────────────────────────────────

const PORT       = parseInt(process.env.PORT || '3001', 10);
const SERVER_URL = process.env.MCP_SERVER_URL ?? `http://localhost:${PORT}`;

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_ANON_KEY) {
  console.error('[luni-mcp] ❌ Missing Supabase env vars. Check SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.');
  process.exit(1);
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.set('trust proxy', 1); // Required for Vercel: allows express-rate-limit to read X-Forwarded-For
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // for login form POST body

const oauthProvider = new LuniOAuthProvider();

// ── OAuth 2.1 endpoints ───────────────────────────────────────────────────────
// mcpAuthRouter mounts:
//   GET  /.well-known/oauth-authorization-server  — discovery
//   GET  /.well-known/oauth-protected-resource    — resource metadata
//   GET  /oauth/authorize                         — calls provider.authorize()
//   POST /oauth/token                             — code exchange + token refresh
//   POST /oauth/register                          — dynamic client registration
//   POST /oauth/revoke                            — token revocation
//
// MUST be mounted at app root (not a sub-path) because /.well-known/* is fixed.
app.use(mcpAuthRouter({
  provider:          oauthProvider,
  issuerUrl:         new URL(SERVER_URL),
  scopesSupported:   ['luni:read'],
  resourceName:      'Luni Financial',
}));

// ── Login form submit (email/password path) ───────────────────────────────────
app.post('/oauth/login', handleLoginSubmit);

// ── Google OAuth completion (called by login.html JS after Google redirect) ───
app.post('/oauth/google-complete', handleGoogleComplete);

// ── MCP endpoint ──────────────────────────────────────────────────────────────
// Each request is stateless: a fresh Server + Transport is created, used,
// and immediately closed. This is serverless-safe (Vercel, Render, Railway).
//
// requireBearerAuth validates the MCP token and populates req.auth with:
//   { token, clientId, scopes, expiresAt, extra: { userId, supabaseRefreshToken } }

app.all('/mcp', requireBearerAuth({ verifier: oauthProvider }), async (req, res) => {
  const mcpToken = req.auth.token;

  // Resolve a fresh Supabase JWT scoped to this user.
  // All tool handlers forward this to the Luni backend which enforces user_id filtering.
  let supabaseJwt;
  try {
    supabaseJwt = await getSupabaseJwtForMcpToken(mcpToken);
  } catch (err) {
    console.error('[luni-mcp] JWT resolution failed:', err.message);
    return res.status(401).json({
      error: 'session_expired',
      error_description: 'Your Luni session has expired. Remove and re-add Luni in Claude settings to reconnect.',
    });
  }

  // Build a fresh MCP Server for this request.
  const server = new Server(
    { name: 'Luni Financial', version: '0.3.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(t => ({
      name:        t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations ?? {
        readOnlyHint:    true,
        destructiveHint: false,
        openWorldHint:   false,
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    const tool = TOOL_BY_NAME[name];

    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      };
    }

    try {
      // Inject the resolved Supabase JWT so auth.js uses it directly.
      // This bypasses the env-var (stdio) and OAuth-exchange (legacy v2) paths.
      const enrichedExtra = { ...extra, resolvedJwt: supabaseJwt };
      return await tool.handler(args ?? {}, enrichedExtra);
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: err.message ?? String(err) }],
      };
    }
  });

  // Stateless transport — no session persistence needed between requests.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[luni-mcp] Transport error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  } finally {
    await server.close().catch(() => {});
  }
});

// ── Health check (Vercel / load balancer probes) ──────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.3.0', server: SERVER_URL });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[luni-mcp] 🚀 Remote server listening on port ${PORT}`);
  console.log(`[luni-mcp] OAuth metadata: ${SERVER_URL}/.well-known/oauth-authorization-server`);
  console.log(`[luni-mcp] MCP endpoint:   ${SERVER_URL}/mcp`);
});

export default app; // for Vercel / testing
