// remote/oauth-provider.js
//
// Implements OAuthServerProvider backed by Supabase.
// Handles the full OAuth 2.1 / PKCE flow so any Luni user can authenticate
// through Claude's "Add custom MCP server" flow and only see their own data.
//
// Flow:
//   1. Claude → GET /oauth/authorize   → provider.authorize() → serves login.html
//   2. User submits email + password   → POST /oauth/login    → Supabase sign-in
//   3. Backend stores auth code, redirects Claude to callback URL with ?code=…
//   4. Claude → POST /oauth/token      → provider.exchangeAuthorizationCode()
//   5. Claude sends Bearer token on every MCP tool call
//   6. verifyAccessToken() returns userId → we mint a fresh Supabase JWT for RLS

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY            = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('[luni-mcp] Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY');
}

// Admin client — bypasses RLS to manage OAuth sessions. Never exposed to users.
const adminDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const ACCESS_TOKEN_TTL_SEC  = 60 * 60;        // 1 hour
const AUTH_CODE_TTL_SEC     = 10 * 60;        // 10 minutes

function secureToken() {
  return 'luni_' + crypto.randomBytes(32).toString('hex');
}

// ── Clients store ─────────────────────────────────────────────────────────────
// Persists Claude's dynamically-registered OAuth client in Supabase so it
// survives server restarts. Claude auto-registers itself on first connect.

class SupabaseClientsStore {
  async getClient(clientId) {
    const { data } = await adminDb
      .from('mcp_oauth_clients')
      .select('*')
      .eq('id', clientId)
      .single();
    if (!data) return undefined;
    return {
      client_id:                    data.id,
      client_secret:                data.client_secret ?? undefined,
      redirect_uris:                data.redirect_uris,
      client_name:                  data.client_name ?? undefined,
      client_uri:                   data.client_uri ?? undefined,
      logo_uri:                     data.logo_uri ?? undefined,
      scope:                        data.scope ?? 'luni:read',
      grant_types:                  data.grant_types,
      response_types:               data.response_types,
      token_endpoint_auth_method:   data.token_endpoint_auth_method,
    };
  }

  async registerClient(client) {
    const { data, error } = await adminDb
      .from('mcp_oauth_clients')
      .upsert({
        id:                           client.client_id,
        client_secret:                client.client_secret ?? null,
        redirect_uris:                client.redirect_uris ?? [],
        client_name:                  client.client_name ?? null,
        client_uri:                   client.client_uri ?? null,
        logo_uri:                     client.logo_uri ?? null,
        scope:                        client.scope ?? 'luni:read',
        grant_types:                  client.grant_types ?? ['authorization_code', 'refresh_token'],
        response_types:               client.response_types ?? ['code'],
        token_endpoint_auth_method:   client.token_endpoint_auth_method ?? 'none',
      }, { onConflict: 'id' })
      .select('*')
      .single();

    if (error) throw new Error(`Client registration failed: ${error.message}`);

    return {
      client_id:                  data.id,
      redirect_uris:              data.redirect_uris,
      grant_types:                data.grant_types,
      response_types:             data.response_types,
      token_endpoint_auth_method: data.token_endpoint_auth_method,
      scope:                      data.scope,
    };
  }
}

// ── LuniOAuthProvider ─────────────────────────────────────────────────────────

export class LuniOAuthProvider {
  constructor() {
    this._clientsStore = new SupabaseClientsStore();
    // We do our own PKCE validation inside exchangeAuthorizationCode
    // so tell the SDK not to double-validate.
    this.skipLocalPkceValidation = false;
  }

  get clientsStore() {
    return this._clientsStore;
  }

  // Step 1: Serve the login form.
  // The SDK calls this when Claude redirects the user to /oauth/authorize.
  async authorize(client, params, res) {
    const { codeChallenge, redirectUri, state, scopes } = params;

    const html = readFileSync(join(__dirname, 'login.html'), 'utf-8')
      .replaceAll('__CLIENT_ID__',        client.client_id)
      .replaceAll('__REDIRECT_URI__',     redirectUri ?? '')
      .replaceAll('__STATE__',            state ?? '')
      .replaceAll('__CODE_CHALLENGE__',   codeChallenge)
      .replaceAll('__SCOPE__',            (scopes ?? ['luni:read']).join(' '))
      .replaceAll('__ERROR__',            '')
      .replaceAll('__SUPABASE_URL__',     SUPABASE_URL)
      .replaceAll('__SUPABASE_ANON_KEY__', ANON_KEY);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  // Step 2a: SDK calls this to retrieve the stored PKCE challenge for a code.
  async challengeForAuthorizationCode(client, authorizationCode) {
    const { data, error } = await adminDb
      .from('mcp_oauth_sessions')
      .select('code_challenge, auth_code_expires_at, auth_code_used')
      .eq('auth_code', authorizationCode)
      .eq('client_id', client.client_id)
      .single();

    if (error || !data)         throw new Error('Invalid or expired authorization code');
    if (data.auth_code_used)    throw new Error('Authorization code already used');
    if (new Date(data.auth_code_expires_at) < new Date()) throw new Error('Authorization code expired');

    return data.code_challenge;
  }

  // Step 2b: Exchange auth code for MCP access + refresh tokens.
  async exchangeAuthorizationCode(client, authorizationCode, codeVerifier, redirectUri) {
    const { data: session, error } = await adminDb
      .from('mcp_oauth_sessions')
      .select('*')
      .eq('auth_code', authorizationCode)
      .eq('client_id', client.client_id)
      .single();

    if (error || !session)       throw new Error('Invalid authorization code');
    if (session.auth_code_used)  throw new Error('Authorization code already used');
    if (new Date(session.auth_code_expires_at) < new Date()) throw new Error('Authorization code expired');

    const accessToken  = secureToken();
    const refreshToken = secureToken();
    const expiresAt    = new Date(Date.now() + ACCESS_TOKEN_TTL_SEC * 1000).toISOString();

    const { error: updateError } = await adminDb
      .from('mcp_oauth_sessions')
      .update({
        auth_code_used:           true,
        access_token:             accessToken,
        refresh_token:            refreshToken,
        access_token_expires_at:  expiresAt,
      })
      .eq('id', session.id);

    if (updateError) throw new Error(`Token generation failed: ${updateError.message}`);

    return {
      access_token:  accessToken,
      token_type:    'bearer',
      expires_in:    ACCESS_TOKEN_TTL_SEC,
      refresh_token: refreshToken,
      scope:         session.scope ?? 'luni:read',
    };
  }

  // Step 3: Refresh an expired access token.
  async exchangeRefreshToken(client, refreshToken, scopes) {
    const { data: session, error } = await adminDb
      .from('mcp_oauth_sessions')
      .select('id, scope, user_id')
      .eq('refresh_token', refreshToken)
      .eq('client_id', client.client_id)
      .single();

    if (error || !session) throw new Error('Invalid refresh token');

    const newAccessToken = secureToken();
    const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SEC * 1000).toISOString();

    await adminDb
      .from('mcp_oauth_sessions')
      .update({ access_token: newAccessToken, access_token_expires_at: expiresAt })
      .eq('id', session.id);

    return {
      access_token:  newAccessToken,
      token_type:    'bearer',
      expires_in:    ACCESS_TOKEN_TTL_SEC,
      refresh_token: refreshToken,
      scope:         session.scope ?? 'luni:read',
    };
  }

  // Called by requireBearerAuth middleware on every /mcp request.
  // Must return AuthInfo with the userId in extra so the server can scope DB queries.
  async verifyAccessToken(token) {
    const { data: session, error } = await adminDb
      .from('mcp_oauth_sessions')
      .select('user_id, client_id, scope, access_token_expires_at, supabase_refresh_token')
      .eq('access_token', token)
      .single();

    if (error || !session) throw new Error('Invalid access token');
    if (new Date(session.access_token_expires_at) < new Date()) throw new Error('Access token expired');

    return {
      token,
      clientId:  session.client_id,
      scopes:    (session.scope ?? 'luni:read').split(' '),
      expiresAt: Math.floor(new Date(session.access_token_expires_at).getTime() / 1000),
      extra: {
        userId:                session.user_id,
        supabaseRefreshToken:  session.supabase_refresh_token,
      },
    };
  }
}

// ── Login form POST handler ────────────────────────────────────────────────────
// The login.html form POSTs here. We sign the user in with Supabase,
// create an auth code, and redirect back to Claude.

export async function handleLoginSubmit(req, res) {
  const { email, password, client_id, redirect_uri, state, code_challenge, scope } = req.body;

  const renderError = (message) => {
    const html = readFileSync(join(__dirname, 'login.html'), 'utf-8')
      .replaceAll('__CLIENT_ID__',        client_id ?? '')
      .replaceAll('__REDIRECT_URI__',     redirect_uri ?? '')
      .replaceAll('__STATE__',            state ?? '')
      .replaceAll('__CODE_CHALLENGE__',   code_challenge ?? '')
      .replaceAll('__SCOPE__',            scope ?? 'luni:read')
      .replaceAll('__ERROR__',            message)
      .replaceAll('__SUPABASE_URL__',     SUPABASE_URL)
      .replaceAll('__SUPABASE_ANON_KEY__', ANON_KEY);
    return res.status(401).setHeader('Content-Type', 'text/html; charset=utf-8').send(html);
  };

  try {
    // Sign in via Supabase anon client (user-scoped, not admin)
    const userClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: authData, error: signInError } = await userClient.auth.signInWithPassword({
      email: email?.trim(),
      password,
    });

    if (signInError || !authData?.user) {
      return renderError('Invalid email or password. Please try again.');
    }

    // Generate a short-lived auth code
    const authCode  = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_SEC * 1000).toISOString();

    const { error: insertError } = await adminDb.from('mcp_oauth_sessions').insert({
      user_id:               authData.user.id,
      auth_code:             authCode,
      code_challenge:        code_challenge,
      redirect_uri:          redirect_uri,
      client_id:             client_id,
      scope:                 scope || 'luni:read',
      auth_code_expires_at:  expiresAt,
      // Store refresh token so we can mint fresh Supabase JWTs on every tool call
      supabase_refresh_token: authData.session?.refresh_token,
    });

    if (insertError) {
      console.error('[oauth] session insert error:', insertError.message);
      return renderError('Something went wrong. Please try again.');
    }

    // Sign the user out of this temporary Supabase session
    // (we've saved the refresh token; we don't need the session object)
    await userClient.auth.signOut();

    // Redirect Claude to its callback with the auth code
    const callbackUrl = new URL(redirect_uri);
    callbackUrl.searchParams.set('code', authCode);
    if (state) callbackUrl.searchParams.set('state', state);

    res.redirect(302, callbackUrl.toString());
  } catch (err) {
    console.error('[oauth] login error:', err.message);
    renderError('Authentication failed. Please try again.');
  }
}

// ── Get a fresh Supabase JWT for a verified MCP token ─────────────────────────
// Called per tool-call in server.js to get a user-scoped JWT.
// RLS on all Luni tables will then enforce that users only see their own data.

export async function getSupabaseJwtForMcpToken(mcpToken) {
  const { data: session, error } = await adminDb
    .from('mcp_oauth_sessions')
    .select('user_id, supabase_refresh_token')
    .eq('access_token', mcpToken)
    .single();

  if (error || !session) throw new Error('MCP token not found');
  if (!session.supabase_refresh_token) throw new Error('No Supabase session linked — user must re-authenticate');

  const userClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: refreshed, error: refreshError } = await userClient.auth.refreshSession({
    refresh_token: session.supabase_refresh_token,
  });

  if (refreshError || !refreshed?.session) {
    throw new Error('Supabase session expired. User must reconnect Luni in Claude settings.');
  }

  // Supabase rotates refresh tokens — persist the new one
  await adminDb
    .from('mcp_oauth_sessions')
    .update({ supabase_refresh_token: refreshed.session.refresh_token })
    .eq('access_token', mcpToken);

  return refreshed.session.access_token;
}

// ── Google OAuth completion ────────────────────────────────────────────────────
// Called client-side (via fetch) after the Supabase Google OAuth redirect.
// The login.html JS sends us the Supabase session tokens + MCP params.
// We verify the session, create an MCP auth code, and return the redirect URL.

export async function handleGoogleComplete(req, res) {
  const { client_id, redirect_uri, state, code_challenge, scope,
          access_token, refresh_token, user_id } = req.body;

  if (!access_token || !refresh_token || !user_id || !client_id || !redirect_uri || !code_challenge) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Verify the Supabase session is real and belongs to user_id
    const { data: { user }, error: userError } = await adminDb.auth.admin.getUserById(user_id);
    if (userError || !user) {
      return res.status(401).json({ error: 'Invalid Supabase session' });
    }

    // Generate MCP auth code
    const authCode  = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_SEC * 1000).toISOString();

    const { error: insertError } = await adminDb.from('mcp_oauth_sessions').insert({
      user_id:               user.id,
      auth_code:             authCode,
      code_challenge:        code_challenge,
      redirect_uri:          redirect_uri,
      client_id:             client_id,
      scope:                 scope || 'luni:read',
      auth_code_expires_at:  expiresAt,
      supabase_refresh_token: refresh_token,
    });

    if (insertError) {
      console.error('[oauth] google-complete insert error:', insertError.message);
      return res.status(500).json({ error: 'Failed to create session' });
    }

    // Build the redirect URL for Claude's callback
    const callbackUrl = new URL(redirect_uri);
    callbackUrl.searchParams.set('code', authCode);
    if (state) callbackUrl.searchParams.set('state', state);

    res.json({ redirect_url: callbackUrl.toString() });
  } catch (err) {
    console.error('[oauth] google-complete error:', err.message);
    res.status(500).json({ error: 'Authentication failed' });
  }
}
