# Luni MCP — Session Log — Session 5

**Date:** May 29, 2026
**Context:** First Cowork session (remote MCP via mcp.luni.ca). Diagnosed root cause of persistent 404 errors. Implemented architectural fix to make MCP tools work without the local Express backend.

---

## Root Cause: Local Backend Not Reachable from Vercel

**Symptom:** `list_transactions` returned `Luni backend returned 404: HTTP 404` when called from Cowork mode.

**Diagnosis:**
- The MCP server is deployed at `mcp.luni.ca` (Vercel project `luni-mcp`, `prj_RjoZaSo6iflD8Is4miDKZTKaYp3M`)
- Vercel auto-deploys on every push to `github.com/rorygeddes/luni_mcp` (main branch)
- `client.js` builds an axios client pointing at `LUNI_BACKEND_URL || "http://localhost:3000"`
- `localhost:3000` is the local Express backend (`luni_app/backend/server.js`) — only reachable on the developer's machine
- From Vercel serverless functions, `localhost:3000` is unreachable → 404

**Why it worked in previous sessions:** All previous sessions used Claude Desktop with the stdio transport. The local MCP server (`server.js`) ran as a child process of Claude Desktop on the user's machine and could reach `localhost:3000` directly. Cowork uses the remote Vercel deployment, which cannot.

---

## Fix: Direct Supabase Queries in MCP Tools

Instead of routing through the Express backend, tools now query Supabase directly using the user's JWT. Supabase's Row Level Security (RLS) enforces per-user data isolation automatically.

### `client.js` changes

Added two new exports:

**`buildSupabaseClient(jwt)`** — creates a `@supabase/supabase-js` client authenticated with the user's JWT. All queries go directly to Supabase; no Express backend needed.

```js
export function buildSupabaseClient(jwt) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

**`normalizeCatToLuniKey(cat)`** — mirrors the category normalization from `luni_app/backend/server.js` (PLAID_TO_LUNI_CAT map + snake_case fallback). Required because tools now receive raw Supabase rows instead of normalized backend responses.

The existing `buildClient()` (axios → Express) is kept as legacy for local stdio mode.

### `tools/list_transactions.js` changes

Replaced `client.get("/api/transactions", { params })` with a direct Supabase query:

```js
const supabase = buildSupabaseClient(jwt);
let query = supabase
  .from("luni_transactions")
  .select("id, date, display_name, merchant_name, amount, category, subcategory, pending, source, is_split, money_type")
  .eq("is_removed", false)
  .order("date", { ascending: false })
  .limit(Math.min(args.limit ?? 50, 200));

// Filters applied conditionally: start_date, end_date, category, min_amount, money_type, merchant_contains
```

Response shape is identical to the backend route — `merchant_name || display_name` → `merchant`, categories normalized via `normalizeCatToLuniKey`.

---

## Deployment

The fix requires a commit + push to `github.com/rorygeddes/luni_mcp` (main branch). Vercel auto-deploys on push.

**Commands to run (in Luni_MCP directory):**
```bash
cd "/Users/rorygeddes/Workspace Desktop/Luni_Financial_Inc/Luni_MCP"
rm -f .git/HEAD.lock .git/index.lock  # clear stale git lock if present
git add client.js tools/list_transactions.js
git commit -m "fix: query Supabase directly in list_transactions, bypass unreachable local backend"
git push origin main
```

These commands were written to clipboard by Claude — paste in Terminal to run.

---

## Architectural Note: All Tools Need This Fix

`list_transactions.js` is now fixed. The other tools that call the Express backend need the same treatment:

| Tool | Backend route | Status |
|------|--------------|--------|
| `list_transactions` | `GET /api/transactions` | ✅ Fixed this session |
| `get_budget_status` | `GET /api/budgets` | ⚠️ Still uses Express |
| `list_splits_outstanding` | `GET /api/splits` | ⚠️ Still uses Express |
| `list_entities` | `GET /api/entities` | ⚠️ Still uses Express |
| `get_cash_flow` | `GET /api/entities/:id/cash-flow` | ⚠️ Still uses Express |
| `get_pnl` | `GET /api/entities/:id/pnl` | ⚠️ Still uses Express |
| `get_recurring` | `GET /api/entities/:id/recurring` | ⚠️ Still uses Express |
| `get_partner_distribution` | `GET /api/entities/:id/distributions` | ⚠️ Still uses Express |

All remaining tools should be migrated to Supabase direct queries in Session 6.

---

## Session 5 Status Board

| Task | Status | Notes |
|------|--------|-------|
| Diagnose 404 root cause | ✅ Done | Local backend unreachable from Vercel |
| Fix list_transactions | ✅ Done | Direct Supabase query |
| Deploy to mcp.luni.ca | ⏳ Pending | Needs git push (commands in clipboard) |
| Fix remaining 7 tools | 📋 Session 6 | Same pattern as list_transactions |

---

## Action Items for Session 6

1. **Push and verify** — after running the git commands, re-run `list_transactions` in Cowork to confirm it returns real data
2. **Migrate remaining tools** to Supabase direct queries using the same pattern
3. **Consider RLS verification** — confirm `luni_transactions` has RLS policy `auth.uid() = user_id` so direct queries are user-scoped. Check Supabase dashboard → Authentication → Policies.
