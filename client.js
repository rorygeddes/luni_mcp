// client.js
//
// Thin axios wrapper around the Luni Express backend.
// Holds NO secrets. Forwards the resolved user JWT on every request so
// all verifyToken middleware, RLS, and Plaid/Wise logic in backend/server.js
// keep enforcing access exactly as they do for the Flutter app.

import axios from "axios";

const BACKEND_URL = process.env.LUNI_BACKEND_URL || "http://localhost:3000";

/**
 * Build an axios instance bound to a specific user's JWT.
 * Called per-tool-invocation after auth.js resolves the token.
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
      // Tag every MCP-originated request for easy backend log filtering.
      "X-Luni-Client": "mcp/0.2.0",
    },
  });
}

/**
 * Wrap an axios error into something a Claude tool result can present cleanly.
 * Never leaks the JWT, stack traces, or internal URLs to the model.
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
