// client.js
//
// Two client strategies for Luni MCP tools:
//
//   buildSupabaseClient(jwt) — PRIMARY (remote/Vercel mode)
//     Creates a Supabase JS client authenticated with the user's JWT.
//     All queries go directly to Supabase; RLS enforces per-user isolation.
//     No Express backend required — works in any serverless environment.
//
//   buildClient(jwt) — LEGACY (local stdio mode)
//     Thin axios wrapper around the local Express backend (localhost:3000).
//     Only used when LUNI_BACKEND_URL is explicitly set and reachable.

import axios from "axios";
import { createClient } from "@supabase/supabase-js";

const BACKEND_URL = process.env.LUNI_BACKEND_URL || "http://localhost:3000";
const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// ── Primary: direct Supabase client ──────────────────────────────────────────

/**
 * Build a Supabase JS client scoped to a specific user's JWT.
 * Supabase RLS (auth.uid() = user_id) enforces row-level isolation automatically.
 * No Express backend needed — safe to call from Vercel serverless functions.
 */
export function buildSupabaseClient(jwt) {
  if (!jwt) {
    throw new Error(
      "No JWT available. Complete the OAuth flow at https://mcp.luni.ca"
    );
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables."
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${jwt}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// ── Category normalization (mirrors luni_app/backend/server.js) ───────────────

const PLAID_TO_LUNI_CAT = {
  'food and drink':        'food_drinks',
  'food_and_drink':        'food_drinks',
  'food & drinks':         'food_drinks',
  'restaurants':           'food_drinks',
  'fast food':             'food_drinks',
  'groceries':             'food_drinks',
  'coffee shop':           'food_drinks',
  'shops':                 'shopping',
  'retail':                'shopping',
  'clothing':              'shopping',
  'general merchandise':   'shopping',
  'general_merchandise':   'shopping',
  'healthcare':            'health',
  'medical':               'health',
  'pharmacy':              'health',
  'gyms and fitness':      'health',
  'bills and utilities':   'bills_utilities',
  'bills_utilities':       'bills_utilities',
  'utilities':             'bills_utilities',
  'service':               'bills_utilities',
  'general services':      'bills_utilities',
  'general_services':      'bills_utilities',
  'airlines and aviation':  'travel',
  'hotels and motels':     'travel',
  'car rental':            'travel',
  'taxi':                  'transportation',
  'ride share':            'transportation',
  'parking':               'transportation',
  'gas stations':          'transportation',
  'recreation':            'entertainment',
  'arts and entertainment': 'entertainment',
  'music':                 'entertainment',
  'education':             'education',
  'transfer_in':           'transfer_in',
  'transfer_out':          'transfer_out',
  'transfer':              'transfer',
  'transfers':             'transfers',
  'loan_payments':         'loan_payments',
  'savings_debt':          'savings_debt',
  'income':                'income',
  'bank_fees':             'bank_fees',
};

/** Convert any category string to a Luni canonical key (e.g. "FOOD_AND_DRINK" → "food_drinks"). */
export function normalizeCatToLuniKey(cat) {
  if (!cat) return '';
  const lower = cat.toLowerCase().replace(/_/g, ' ').trim();
  if (PLAID_TO_LUNI_CAT[lower]) return PLAID_TO_LUNI_CAT[lower];
  return lower.replace(/[\s&]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

// ── Legacy: axios wrapper around local Express backend ────────────────────────

/**
 * Build an axios instance bound to a specific user's JWT.
 * Only works when LUNI_BACKEND_URL is set and the backend is reachable.
 * @deprecated Prefer buildSupabaseClient for remote/Vercel deployments.
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
      "X-Luni-Client": "mcp/0.3.0",
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
