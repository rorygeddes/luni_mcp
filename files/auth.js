// auth.js
//
// Resolves the Supabase JWT to use for the current tool call.
//
// v1 (local stdio):
//   - JWT comes from the LUNI_JWT env var, set in claude_desktop_config.json.
//   - You generate this once for yourself (and once per design-partner customer
//     like Jill) by signing in as that user in the Luni app and copying the
//     `currentSession.accessToken`. Refresh when it expires (~1 hour for default
//     Supabase config; bump `JWT_EXPIRY` in Supabase Auth settings to make this
//     less painful during dev).
//
// v2 (remote HTTP + OAuth) — NOT IMPLEMENTED YET:
//   - The MCP SDK will give us the OAuth bearer token per-request via
//     RequestHandlerExtra. We'll trade it for a Supabase session JWT through
//     your backend (`POST /api/auth/exchange-oauth-token` or similar), cache it
//     for its TTL, and return it here.
//   - At that point this file gains a `resolveJwtFromOAuth(extra)` branch and
//     server.js wires it in.
//
// Either way, the rest of the MCP server doesn't care — it just calls
// `getJwt(extra)` and gets back a string.

export function getJwt(_extra) {
  const fromEnv = process.env.LUNI_JWT;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  throw new Error(
    "LUNI_JWT is not set. In local mode, add it to the env block " +
      "of your claude_desktop_config.json under mcpServers.luni.env."
  );
}
