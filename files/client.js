// client.js
//
// Thin axios wrapper around your existing Luni Express backend.
// This file holds NO secrets. It just forwards the user's Supabase JWT
// on every request, so all your existing RLS, auth middleware, and
// Plaid/Wise/OpenAI logic in backend/server.js continues to enforce
// access control exactly as it does for the Flutter app.
//
// Why route through the backend instead of hitting Supabase directly?
//   1. Your backend already has verifyToken middleware, RLS-aware
//      queries, and helpful response shaping. Reusing it means the MCP
//      server can't accidentally bypass any of that.
//   2. If you change a query in server.js, the MCP server inherits the
//      fix for free.
//   3. The MCP server stays small and obvious — it's a translator, not
//      a database client.

import axios from "axios";

const BACKEND_URL = process.env.LUNI_BACKEND_URL || "http://localhost:3000";

/**
 * Build an axios instance bound to a specific user's JWT.
 * Called per-tool-invocation (auth.js produces the token).
 */
export function buildClient(jwt) {
  if (!jwt) {
    throw new Error(
      "No JWT available. Set LUNI_JWT in claude_desktop_config.json " +
        "(local stdio mode) or complete the OAuth flow (remote mode)."
    );
  }

  return axios.create({
    baseURL: BACKEND_URL,
    timeout: 15_000,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      // Helps you grep your backend logs later — every MCP-originated
      // request will be tagged.
      "X-Luni-Client": "mcp/0.1.0",
    },
  });
}

/**
 * Wrap an axios error into something a Claude tool result can present
 * cleanly. Never leaks the JWT, stack traces, or internal URLs to the
 * model.
 */
export function formatBackendError(err) {
  if (err.response) {
    const { status, data } = err.response;
    const message =
      (data && (data.error || data.message)) || `HTTP ${status}`;
    return `Luni backend returned ${status}: ${message}`;
  }
  if (err.request) {
    return `Could not reach Luni backend at ${BACKEND_URL}. Is it running?`;
  }
  return `Unexpected error calling Luni backend: ${err.message}`;
}
