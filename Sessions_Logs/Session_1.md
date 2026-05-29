# Luni MCP — Client ↔ Builder Session Log

This document records every MCP tool call made against the Luni backend, what came back, what was wrong, and what was fixed. It is a living document — append a new round each time the loop runs.

---

## Setup

- **MCP server:** `Luni_MCP/server.js` v0.2.0 — 8 tools, stdio transport
- **Backend:** `luni_app/backend/server.js` — Express on `localhost:3000`, managed by nodemon
- **Database:** Supabase project `cpsjbwtezrnajaiolsim`
- **Auth:** Supabase session JWT passed via `LUNI_JWT` env var in `claude_desktop_config.json`

---

## Round 1 — Initial Probe (May 2026)

### Role: Client (Claude acting as a Luni Business user)

The client wanted to understand:
1. What did I spend this month?
2. How am I tracking against my budgets?
3. Does anyone owe me money?

---

### Call 1 — `list_transactions(limit=20, start_date="2026-05-01")`

**What came back:**
```json
{
  "count": 20,
  "transactions": [
    { "id": "...", "date": "2026-05-12", "merchant": null, "amount": -12.50, "category": "FOOD_AND_DRINK", "subcategory": "Fast Food", ... },
    { "id": "...", "date": "2026-05-10", "merchant": "Shoppers Drug Mart", "amount": -34.99, "category": "GENERAL_MERCHANDISE", "subcategory": "Shops", ... },
    ...
  ]
}
```

**Issues found:**

| # | Problem | Root cause |
|---|---------|-----------|
| A | `merchant` is `null` on many rows | `display_name` column is NULL in DB for all rows; `merchant_name` is populated but response fallback logic returned null |
| B | `category` values are Plaid raw enums: `FOOD_AND_DRINK`, `GENERAL_MERCHANDISE` | Backend was passing raw Plaid strings through without normalising to Luni format |
| C | `subcategory` inconsistent: mix of `"Fast Food"`, `"Shops"`, `"food_drinks"` | Some rows set by Plaid, others manually tagged in Luni format |

**Client verdict:** Unusable for budgeting. Category strings are meaningless to the user. Merchant being null on common items (McDonald's, Tim Hortons) is a data quality failure.

---

### Call 2 — `get_budget_status(month="2026-05")`

**What came back:**
```json
{
  "month": "2026-05",
  "categories": [
    { "category": "Food & Drinks", "budget": 0, "spent": 0, "remaining": 0, "pace": "no_budget_set" },
    { "category": "Shopping",      "budget": 0, "spent": 0, "remaining": 0, "pace": "no_budget_set" },
    { "category": "Travel",        "budget": 0, "spent": 0, "remaining": 0, "pace": "no_budget_set" },
    ...
  ]
}
```

**Issues found:**

| # | Problem | Root cause |
|---|---------|-----------|
| D | Every budget shows `budget: 0` | Backend returned field named `budget` but MCP tool reads `b.amount` — field name mismatch |
| E | Every category shows `spent: 0` | Budget spend query used `.eq('subcategory', b.category_key)` — but `category_key = 'food_drinks'` doesn't match `subcategory = 'Food & Drinks'` or `'FOOD_AND_DRINK'`. Zero matches. |

**Actual budget data confirmed in Supabase:**
- Food & Drinks: $15/mo (`category_key: food_drinks`)
- Shopping: $40/mo (`category_key: shopping`)
- Entertainment: $180/mo (`category_key: entertainment`)
- Education: $275/mo (`category_key: education`)
- Health: $10/mo (`category_key: health`)
- Travel: $10/mo (`category_key: travel`)
- Transportation: $10/mo (`category_key: transportation`)
- Bills: $10/mo (`category_key: bills_utilities`)

**Client verdict:** Completely broken. Every budget reads as $0 with $0 spent. No financial insight possible.

---

### Call 3 — `list_splits_outstanding()`

**What came back:**
```
Error 500: column luni_splits.amount does not exist
```

**Issues found:**

| # | Problem | Root cause |
|---|---------|-----------|
| F | Route crashes immediately | Backend selected `amount` but real column is `total_amount` |
| G | Route selects `date`, `direction`, `other_party_name`, `settlement_status` | None of these columns exist in `luni_splits` |

**Actual `luni_splits` columns confirmed via Supabase schema:**
```
id, user_id, transaction_id, status, note, total_amount,
group_id, payer_user_id, split_type, source, description,
space_id, created_at, updated_at
```

**Client verdict:** Total crash. No splits data available at all.

---

## Round 1 → Round 2 — Builder Fixes Applied

### Fix A+B+C: Transaction category normalization

**File:** `luni_app/backend/server.js`

Added `PLAID_TO_LUNI_CAT` lookup map and `normalizeCatToLuniKey()` helper function. Applied to both `category` and `subcategory` fields in the `/api/transactions` response mapping.

Before:
```js
category:    t.category,       // "FOOD_AND_DRINK"
subcategory: t.subcategory,    // "Fast Food"
```

After:
```js
category:    normalizeCatToLuniKey(t.category),     // "food_drinks"
subcategory: normalizeCatToLuniKey(t.subcategory),  // "food_drinks"
```

The normalization map handles 20+ known Plaid raw strings and falls back to a generic snake_case conversion.

---

### Fix D: Budget field name mismatch

**File:** `luni_app/backend/server.js` `/api/budgets` route

Before:
```js
return {
  category: b.name,
  budget:   parseFloat(b.budget_amount) || 0,  // ← MCP reads 'amount', not 'budget'
  ...
};
```

After:
```js
return {
  category: b.name,
  amount:   parseFloat(b.budget_amount) || 0,  // ← now matches MCP tool expectation
  ...
};
```

---

### Fix E: Budget spend — category format mismatch

**File:** `luni_app/backend/server.js` `/api/budgets` route

Replaced the per-budget N+1 query pattern (which also failed due to format mismatch) with:
1. Fetch ALL month transactions once in a single Supabase query
2. In JS, filter each budget's matching transactions using `normalizeCatToLuniKey()` on both sides

Before:
```js
// Per budget (N+1), fails because 'food_drinks' ≠ 'Food & Drinks'
spendQuery.eq('subcategory', b.category_key)
```

After:
```js
// Single fetch, JS filter with normalization
const txns = allTxns.filter(t =>
  normalizeCatToLuniKey(t.category)    === budgetKey ||
  normalizeCatToLuniKey(t.subcategory) === budgetKey
);
```

Side effect: reduced DB round-trips from N+1 to N+2 (one for budgets, one for transactions).

---

### Fix F+G: Splits route rewrite

**File:** `luni_app/backend/server.js` `/api/splits` route

Completely rewrote the route to use real column names. Added a second query to batch-fetch linked transaction metadata (date, merchant) so splits have useful context.

Before:
```js
.select('id, amount, description, date, direction, other_party_name, settlement_status')
// → crashes: amount, date, direction, other_party_name, settlement_status don't exist
```

After:
```js
.select('id, status, note, description, total_amount, split_type, payer_user_id, created_at, transaction_id')
// → correct columns; then batch-joins luni_transactions for date + merchant
```

Also enriched the response shape:
```json
{
  "splits": [...],
  "summary": {
    "total_owed_to_you": 0.00,
    "total_you_owe": 0.00,
    "count": 0
  }
}
```

---

## Round 2 — Re-test (pending)

Backend auto-restarted via nodemon after edits. Syntax check: passed.

To complete Round 2, re-run the same 3 calls in Claude Desktop via the Luni connector:

1. `list_transactions(limit=20, start_date="2026-05-01")` — expect normalized `category` values (e.g. `food_drinks` instead of `FOOD_AND_DRINK`) and populated `merchant` names
2. `get_budget_status(month="2026-05")` — expect real dollar amounts per category and non-zero `spent` values where transactions exist
3. `list_splits_outstanding()` — expect either a working response or an empty list (not a crash)

---

## Pending Work

### Backend routes not yet implemented (business entity tools)

The 5 business entity tools in the MCP have no matching backend routes. They will return 404 until these are built:

| MCP Tool | Backend Route |
|---|---|
| `list_entities` | `GET /api/entities` |
| `get_cash_flow` | `GET /api/entities/:id/cash-flow` |
| `get_pnl` | `GET /api/entities/:id/pnl` |
| `get_recurring` | `GET /api/entities/:id/recurring` |
| `get_partner_distribution` | `GET /api/entities/:id/distributions` |

### Data quality issues to investigate in Round 2+

- Why is `display_name` NULL for all transactions? Plaid should populate this. Check the onboarding sync.
- Confirm Luni transaction `amount` sign convention: negative = outflow? (assumed in budget calc)
- Check what `status` values actually exist in `luni_splits` — the filter `neq('status', 'settled')` assumes 'settled' is the done state
- Verify that `payer_user_id` in `luni_splits` correctly identifies who paid, and that comparing to `userId` gives the right "you_are_payer" direction

---

## Schema Reference (confirmed)

### `luni_transactions` (key columns)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → users |
| `date` | date | Transaction date |
| `merchant_name` | text | Populated by Plaid |
| `display_name` | text | NULL for all current rows |
| `amount` | numeric | Negative = outflow (Plaid convention) |
| `category` | text | Raw Plaid enum OR Luni key |
| `subcategory` | text | More specific label, inconsistent format |
| `is_removed` | bool | Soft delete flag |
| `is_split` | bool | Split transaction flag |
| `pending` | bool | Not yet settled |
| `money_type` | text | income / expense / transfer |
| `source` | text | plaid / wise / manual |

### `luni_budgets` (key columns)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → users |
| `name` | text | Display name, e.g. "Food & Drinks" |
| `category_key` | text | Luni canonical key, e.g. "food_drinks" |
| `budget_amount` | numeric | Monthly limit |
| `currency` | text | "CAD" |

### `luni_splits` (key columns)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → users |
| `transaction_id` | uuid | FK → luni_transactions |
| `status` | text | e.g. "pending", "settled" |
| `total_amount` | numeric | Full amount being split |
| `payer_user_id` | uuid | Who paid |
| `split_type` | text | e.g. "equal", "custom" |
| `description` | text | What the split is for |
| `note` | text | Freeform note |
| `created_at` | timestamptz | Creation time |
