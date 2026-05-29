// auth.js
//
// Resolves which Supabase JWT to use for the current tool call.
//
// v1 — local stdio (active now):
//   JWT is pasted into LUNI_JWT in claude_desktop_config.json.
//   Generate it once per user by copying currentSession.accessToken from
//   the Luni app. Bump JWT_EXPIRY in Supabase Auth settings to e.g. 24h
//   during development so you're not re-pasting every hour.
//
// v2 — remote HTTP + OAuth (TODO):
//   When the server moves to SSE transport, Claude sends a bearer token
//   per the OAuth 2.1/PKCE flow. resolveJwtFromOAuth() below handles
//   the exchange — your backend's POST /oauth/token returns a short-lived
//   Supabase JWT scoped to the authenticated user.
//
// Callers always use getJwt(extra). v1 falls through immediately;
// v2 will branch on whether extra.authInfo exists.

// ─── v2 OAuth config (set these env vars on your Vercel deployment) ─────────
// LUNI_OAUTH_INTROSPECT_URL  e.g. https://api.luni.ca/oauth/introspect
// LUNI_OAUTH_EXCHANGE_URL    e.g. https://api.luni.ca/oauth/token-exchange
// ─────────────────────────────────────────────────────────────────────────────

// Simple in-memory cache so we don't exchange on every tool call.
// In a multi-worker deployment, replace with Redis or Supabase KV.
const _jwtCache = new Map(); // oauthToken → { jwt, expiresAt }

export async function getJwt(extra) {
  // ── v3: pre-resolved Supabase JWT from remote server (fastest path) ──────
  // remote/server.js exchanges the MCP Bearer token for a fresh Supabase JWT
  // before invoking the tool, then passes it here via extra.resolvedJwt.
  // This means RLS is enforced at the DB level — users only ever see their data.
  if (extra?.resolvedJwt) {
    return extra.resolvedJwt;
  }

  // ── v2: OAuth bearer present in request context ──────────────────────────
  // extra.authInfo is populated by the MCP SDK when the server runs with
  // an HTTP transport and the client authenticated via OAuth 2.1.
  if (extra?.authInfo?.token) {
    return resolveJwtFromOAuth(extra.authInfo.token);
  }

  // ── v1: JWT from env (local stdio) ───────────────────────────────────────
  const fromEnv = process.env.LUNI_JWT;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }

  throw new Error(
    "No JWT available. " +
      "In local stdio mode: add LUNI_JWT to the env block of your " +
      "claude_desktop_config.json. " +
      "In remote mode: complete the OAuth 2.1 flow at https://mcp.luni.ca"
  );
}

// ─── v2 implementation (not wired until remote transport is live) ────────────

async function resolveJwtFromOAuth(oauthToken) {
  // Check cache first.
  const cached = _jwtCache.get(oauthToken);
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.jwt;
  }

  // Exchange the OAuth bearer for a Supabase session JWT.
  // Your backend enforces that the OAuth token belongs to a valid Luni
  // user and returns a JWT scoped to that user's RLS row — same as
  // if they'd signed in through the app.
  //
  // POST /oauth/token-exchange
  // Body: { oauth_token: "..." }
  // Response: { jwt: "eyJ...", expires_in: 3600 }
  //
  // TODO: implement this endpoint in backend/server.js once SSE transport
  //       is wired in remote/vercel-handler.js.

  const exchangeUrl = process.env.LUNI_OAUTH_EXCHANGE_URL;
  if (!exchangeUrl) {
    throw new Error(
      "LUNI_OAUTH_EXCHANGE_URL is not set. " +
        "The OAuth-to-Supabase JWT exchange is not yet configured on this server."
    );
  }

  const resp = await fetch(exchangeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oauth_token: oauthToken }),
  });

  if (!resp.ok) {
    throw new Error(
      `OAuth token exchange failed: HTTP ${resp.status} from ${exchangeUrl}`
    );
  }

  const { jwt, expires_in } = await resp.json();
  if (!jwt) throw new Error("OAuth exchange returned no jwt field.");

  _jwtCache.set(oauthToken, {
    jwt,
    expiresAt: Date.now() + (expires_in ?? 3600) * 1000,
  });

  return jwt;
}
