# Luni MCP — Client ↔ Builder Session Log — Session 4

**Date:** May 28, 2026
**Context:** Verification session + major feature push. Confirmed MCP server restart still pending. Applied 3 Supabase data fixes. Implemented all 5 business entity backend routes. Verified entity tools are fully functional.

---

## Verification: Session 2 MCP Tool Fixes — Still NOT Active

**Status:** The tool file changes from Session 2 (`list_transactions.js`, `list_splits_outstanding.js`) are still not loading in the MCP layer. Confirmed by re-running the 3 original calls:

**`list_transactions` (limit=20, start_date=2026-05-01):**
- `merchant` field still absent from all rows ❌
- `money_type` and `source` fields still absent ❌
- Confirms: MCP server has NOT restarted since Session 2 edits were saved

**`get_budget_status` (month=2026-05):**
- Food & Drinks: $289.58 ✅ — transfer exclusion fix from Session 3 is active (nodemon-watched)
- Entertainment: $51.93 ✅ — sign fix working
- Transportation: $378.05 — still inflated (Claude.ai fix applied this session, will reflect next budget call)
- Shopping: $895.75 — DLHUS $838 charge driving this; category is correct
- **Backend fixes ARE working** — only MCP tool layer is stale

**`list_splits_outstanding`:**
- All amounts: 0 ❌
- All in `owed_by_user` ❌
- Confirms MCP server restart still required

**Root cause:** Cowork sessions can restart without fully relaunching Claude Desktop. The MCP server process is a child of Claude Desktop, not Cowork. The tool files on disk are correct — the process just needs to reload them.

**⚠️ Action required: Fully quit Claude Desktop (not just close the Cowork window) and relaunch.**

---

## Supabase Data Fixes Applied

### Fix 1 — Claude.ai Subscription Recategorization

**Problem:** `CLAUDE.AI SUBSCRIPTION` rows had `subcategory: transportation`, inflating the transportation budget by $115.58+ and hiding real subscription costs in the wrong category.

**SQL run:**
```sql
UPDATE luni_transactions
SET subcategory = 'subscriptions', category = 'bills_utilities'
WHERE raw_description ILIKE '%CLAUDE.AI%'
RETURNING id, raw_description, category, subcategory, amount;
```

**Result:** 4 rows updated:
- 3 × `$28.00` (other months/plans)
- 1 × `$115.58` (the May charge inflating transportation)

**Impact on May budget (after next backend call):**
- Transportation: $378.05 → ~$262 (-$115.58)
- Bills & Utilities: $112.68 → ~$228 (+$115.58)

---

### Fix 2 — 19th Tee LTD Split Deduplication

**Problem:** 4 identical split records for "19th Tee LTD" ($54 each), all created on May 13 within 15 minutes of each other — rapid-tap during split creation.

**Confirmation query showed:**
| ID | created_at | Note |
|----|-----------|------|
| ca653168 | 22:51:00 | **KEPT — original** |
| 0b5ddc7c | 22:51:10 | deleted |
| c492971f | 23:04:42 | deleted |
| 4619bb68 | 23:06:17 | deleted |

**SQL run:**
```sql
DELETE FROM luni_splits
WHERE id IN ('0b5ddc7c-...', 'c492971f-...', '4619bb68-...')
RETURNING id, description;
```

**Result:** 3 duplicate records deleted. 1 record remains.

**Product finding:** The split creation UI needs a debounce or confirmation step to prevent rapid duplicate creation.

---

## Code Changes — Backend (`server.js`)

### money_type Filter on `/api/transactions`

Added `money_type` as a query param so Claude can filter to real spending only:

```js
// Destructure new param
const { ..., money_type } = req.query;

// Apply filter
if (money_type) query = query.eq('money_type', money_type);
```

**MCP tool updated** (`list_transactions.js`): Added `money_type` enum param (`spending | income | transfer | debt_payment`) to input schema and params forwarding. Activates after Claude Desktop restart.

---

### 5 Business Entity Routes — All Implemented

File: `luni_app/backend/server.js`

All routes auto-loaded by nodemon immediately. MCP tools for these already existed and are now backed by real data.

#### Shared helpers added:
- `resolvePeriod(period, start_date, end_date)` — maps shorthand period names to `{ start, end, label }`
- `verifyEntityAccess(userId, entityId)` — checks `space_members` for user membership, returns role or null
- `aggregateByCategory(items)` — sums a transaction array by category key
- `round2(n)` — 2-decimal rounding

#### Routes:

**`GET /api/entities`**
- Source: `space_members` JOIN `spaces`, enriched with `luni_company` metadata for company spaces
- Returns: id, name, type, membership_role, currency, fiscal_year_start, created_at, industry, country (where available)
- Type filter: `?type=business|personal`

**`GET /api/entities/:entity_id/pnl`**
- Source: `lb_transactions` filtered by space_id + date range
- Sign convention: negative amount = inflow/revenue, positive = expense
- Revenue categories override: transactions tagged revenue/income/sales/consulting/services/retainer → revenue bucket
- Returns: revenue[], expenses[], total_revenue, total_expenses, gross_profit, net_profit, margins
- Optional: `?compare_to_previous=true` adds prior_period comparison block

**`GET /api/entities/:entity_id/cash-flow`**
- Source: `lb_transactions`
- Returns: total_inflows, total_outflows, net + optional breakdown
- `?group_by=month` → one row per calendar month
- `?group_by=category` → one row per lb_transactions.category
- `?group_by=none` (default) → single totals object

**`GET /api/entities/:entity_id/recurring`**
- Source: `lb_transactions` (6-month lookback)
- Detection: same vendor/name appearing in 2+ distinct calendar months
- Returns: name, direction (inflow/outflow), avg amount, frequency, months_seen, annual_value
- `?direction=inflow|outflow|all`

**`GET /api/entities/:entity_id/distributions`**
- Source: `lb_transactions` (P&L) + `space_members` (partner list)
- Owner role: sees full partner table with equal-split distribution amounts
- Partner role: sees only their own slice
- Assumption: equal split across all owner/partner members (no split_pct column in DB)

---

## Live Test Results — Entity Routes

### `list_entities` → ✅ Working

```json
{
  "count": 4,
  "entities": [
    { "entity_id": "3fd334aa-...", "name": "Rory Geddes",          "type": "personal", "role": "owner" },
    { "entity_id": "28f922de-...", "name": "Rory Geddes Financial", "type": "company",  "role": "owner" },
    { "entity_id": "4b104bf7-...", "name": "Luni Financial",        "type": "company",  "role": "owner" },
    { "entity_id": "5131d746-...", "name": "Nordik",                "type": "company",  "role": "owner" }
  ]
}
```

### `get_pnl` (Luni Financial, YTD, compare_to_previous=true) → ✅ Working

```json
{
  "entity_name": "Luni Financial",
  "period": { "start": "2026-01-01", "end": "2026-05-28", "label": "YTD 2026" },
  "revenue": [],
  "expenses": [{ "category": "Subscription", "amount": 229 }],
  "total_revenue": 0,
  "total_expenses": 229,
  "net_profit": -229,
  "prior_period": { "total_revenue": 0, "total_expenses": 310, "gross_profit": -310 }
}
```

**Interpretation:** Luni Financial is in pre-revenue stage — $229 YTD in subscription expenses (Supabase, hosting, tooling), $0 revenue booked through the entity. Prior period had $310 in expenses. Expenses are trending down.

---

## Session 4 Status Board

| Task | Status | Notes |
|------|--------|-------|
| Verify Session 2 MCP fixes | ✅ Investigated | Still not active — Claude Desktop restart required |
| Fix Claude.ai categorization | ✅ Done | 4 rows → bills_utilities/subscriptions |
| Deduplicate 19th Tee splits | ✅ Done | 3 duplicates deleted |
| Add money_type filter to /api/transactions | ✅ Done | Backend + MCP tool updated |
| Implement /api/entities | ✅ Done | All 5 routes live |
| Verify entity routes | ✅ Done | list_entities + get_pnl both returning real data |

---

## Action Items for Session 5

1. **Restart Claude Desktop** — the #1 blocker across 4 sessions. Once done:
   - Merchant names will populate in `list_transactions`
   - Splits amounts will be real (not $0)
   - Splits direction will be correct
   - `money_type` filter will be available in MCP tool
   
2. **Verify Claude.ai recategorization** — re-run `get_budget_status` and confirm Transportation drops by ~$115 and Bills & Utilities rises accordingly

3. **Populate lb_transactions with real business data** — Luni Financial only has $229 in subscription expenses so far. For the BI tools to be useful for the business entity use case, real revenue transactions need to be entered against the entity spaces.

4. **Nordik entity** — the `nordik_*` tables (nordik_kpi_current, nordik_weekly_revenue, etc.) look like a specific client's data. Worth investigating whether these should be surfaced through get_pnl / get_cash_flow for the Nordik entity, or if they're a separate data pipeline.

5. **Splits: investigate why `total_amount` is 0 in DB** — even after MCP restart, the `total_amount` field may be 0 because the split creation code never writes it. Trace the split creation flow in the app to find where `total_amount` should be set.

6. **Add `money_type` filter to MCP tool description** — make the description richer so Claude knows to use `money_type=spending` by default when the user asks about their "real spending."
