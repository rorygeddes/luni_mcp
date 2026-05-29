# Luni MCP — Client ↔ Builder Session Log — Session 2

**Date:** May 28, 2026
**Context:** Round 2 re-test after Session 1 fixes. Three calls re-run against the patched backend. Four new issues found; four fixes applied.

---

## Round 2 — Re-test Calls

### Call 1 — `list_transactions(limit=20, start_date="2026-05-01")`

**What came back:**
```json
{
  "count": 20,
  "transactions": [
    { "id": "a3d1c078-...", "date": "2026-05-19", "amount": 12.43, "category": "food_drinks", "subcategory": "food_drinks", "pending": false, "split": false },
    { "id": "4c8005b0-...", "date": "2026-05-19", "amount": 9.50, "category": "transfers", "subcategory": "food_drinks", ... },
    ...
  ]
}
```

**What improved vs Session 1:**

- Categories now normalized ✅ — `FOOD_AND_DRINK` → `food_drinks`, `GENERAL_MERCHANDISE` → `shopping`
- No more crashes ✅

**New issues found:**

| # | Problem | Root cause |
|---|---------|-----------|
| A | `merchant` field missing from every row | MCP tool reads `t.merchant_name ?? t.name`; backend returns `t.merchant`. Field name mismatch — undefined resolves to `null`, JSON omits it |
| B | `subcategory` = `category` for all rows | Normalization is too aggressive — `subcategory: "Food & Drinks"` normalises to `"food_drinks"`, same as parent category. Acceptable for matching; cosmetically redundant |
| C | Transfer transactions pollute results | `category: "transfer_in"`, `"transfer_out"`, `"transfers"` showing alongside spending. Not filterable without a `money_type` filter |

**Client verdict:** Categories are clean now. Merchant is still null — can't tell "Shoppers Drug Mart" from "McDonald's". Transfers in the list add noise.

---

### Call 2 — `get_budget_status(month="2026-05")`

**What came back:**
```json
{
  "month": "2026-05",
  "month_progress_pct": 90,
  "categories": [
    { "category": "Food & Drinks Budget", "budget": 15, "spent": 0, "remaining": 15, "pace": "underspending" },
    { "category": "Entertainment Budget", "budget": 180, "spent": 200.96, "remaining": -20.96, "pace": "over" },
    { "category": "Transportation Budget", "budget": 10, "spent": 64.67, "remaining": -54.67, "pace": "over" },
    { "category": "Education Budget", "budget": 275, "spent": 250, "remaining": 25, "pace": "on_track" },
    { "category": "Shopping Budget", "budget": 40, "spent": 18.74, "remaining": 21.26, "pace": "on_track" },
    ...
  ]
}
```

**What improved vs Session 1:**

- Budget amounts are real dollars ✅ — Education $275, Entertainment $180, etc. (Fix D from Session 1 worked)

**New issues found:**

| # | Problem | Root cause |
|---|---------|-----------|
| D | `Food & Drinks` shows `spent: 0` despite clear food transactions | Sign convention bug: `Math.min(amt, 0)` only counts negative amounts as spending. Luni uses **positive = expense**. All food transactions have positive amounts — all ignored |
| E | `Entertainment` shows `spent: 200.96` but includes income | Transaction `amount: -189.96, category: entertainment, subcategory: income` is negative → `Math.abs(Math.min(-189.96, 0)) = 189.96` — income counted as spending |
| F | Category names include " Budget" suffix | `luni_budgets.name` stores `"Food & Drinks Budget"`, `"Entertainment Budget"` etc. — suffix leaks into MCP response |

**Sign convention confirmed:**
- Positive amounts = expenses (food $12.43, shopping $22.58)
- Negative amounts = income/credits (-$30.91, -$87.25, -$189.96)

**Client verdict:** Budget amounts are now visible — major improvement. But Food shows $0 spent which is clearly wrong. Entertainment is wildly inflated because income is being counted as spending.

---

### Call 3 — `list_splits_outstanding()`

**What came back:**
```json
{
  "total_owed_to_user": 0,
  "total_owed_by_user": 0,
  "net": 0,
  "owed_to_user": [],
  "owed_by_user": [
    { "split_id": "351b3d17-...", "date": "2026-05-19", "amount": 0 },
    ...13 entries, all amount: 0
  ]
}
```

**What improved vs Session 1:**

- No longer crashes ✅ — route returns data instead of a 500 error

**New issues found:**

| # | Problem | Root cause |
|---|---------|-----------|
| G | All split amounts are 0 | MCP tool reads `s.amount_owed` — doesn't exist. Backend returns `s.total_amount`. Field name mismatch; undefined → 0 |
| H | All splits in `owed_by_user` | MCP uses `s.direction === "incoming"` to sort. Backend doesn't return `direction`. So condition is always false → everything goes to `owed_by_user` |
| I | No transaction/merchant description | MCP reads `s.merchant_name` and `s.transaction_description` — neither exist. Backend returns `s.merchant` and `s.description` |

**Client verdict:** No longer crashes but completely useless — all amounts zero, no descriptions, wrong direction on all entries.

---

## Session 2 Fixes Applied

### Fix A — Transactions: merchant field name in MCP tool

**File:** `Luni_MCP/tools/list_transactions.js`

```js
// Before
merchant: t.merchant_name ?? t.name,
split: t.is_split ?? false,

// After
merchant: t.merchant,        // backend returns 'merchant', not 'merchant_name'
split: t.split ?? false,     // backend returns 'split', not 'is_split'
money_type: t.money_type,    // added — useful for filtering income vs expense
source: t.source,            // added — shows plaid / wise / manual
```

---

### Fix D+E — Budget: sign convention (positive = expense in Luni)

**File:** `luni_app/backend/server.js` `/api/budgets` route

```js
// Before — only counted negative amounts (income!) as spending
return sum + Math.abs(Math.min(amt, 0));

// After — counts positive amounts (actual expenses) as spending
return sum + Math.max(amt, 0);
```

---

### Fix F — Budget: strip " Budget" suffix from category names

**File:** `luni_app/backend/server.js` `/api/budgets` route

```js
// Before
category: b.name,  // "Food & Drinks Budget"

// After
category: b.name.replace(/\s*Budget\s*$/i, '').trim(),  // "Food & Drinks"
```

---

### Fix G+H+I — Splits: MCP tool field name mismatches

**File:** `Luni_MCP/tools/list_splits_outstanding.js`

```js
// Before — reading fields that don't exist in backend response
amount: Number(s.amount_owed ?? 0),     // → always 0
transaction: s.transaction_description ?? s.merchant_name,  // → always undefined
if (s.direction === "incoming" ...)     // → always false

// After — reading actual backend fields
amount: Number(s.total_amount ?? 0),    // backend field
transaction: s.merchant || s.description,
if (s.you_are_payer) ...               // you paid = others owe you
```

---

## Outstanding Issues (carry to Session 3)

### Merchant still null in transactions (Issue A — partial fix)

The MCP tool now reads the right field (`t.merchant`), but the backend maps `t.merchant = t.merchant_name || t.display_name` — and both columns are NULL in the database for all rows. This means merchant will still show as null after the fix.

**Root cause:** The Plaid sync is not populating `merchant_name`. The `display_name` column is also empty. This needs investigation at the Plaid sync layer, not the API layer.

**Next step:** Query luni_transactions to check if any rows have non-null `merchant_name`. If none, the Plaid sync's field mapping needs to be verified.

### Splits total_amount is 0 in the DB (Issue G — partial fix)

The MCP tool now reads the right field (`total_amount`), but that field is `0` or `NULL` for all split records. The split creation logic never set the amount.

**Next step:** Check luni_splits data directly and trace the split creation code to see why `total_amount` isn't being written.

### Transfer transactions polluting spend view (Issue C — not yet fixed)

`transfer_in`, `transfer_out`, `transfers`, `savings_debt`, `loan_payments` categories appear in the transaction list. These inflate category totals when subcategory accidentally matches a budget key (e.g., a transfer with `subcategory: food_drinks`).

**Proposed fix:** In the `/api/transactions` response and budget calculation, exclude transactions where `money_type = 'income'` or `is_transfer = true` or category is a known transfer category.

### Budget amounts seem unrealistic (Issue — data quality)

With the sign fix applied, Food & Drinks will now show ~$138 spent vs a $15 budget. The budgets haven't been updated since initial setup and don't reflect actual spending patterns.

**This is a product issue, not a code bug** — the user needs to update their budget amounts in the Luni app.

---

## Confirmed Working After Session 1 + 2

| Feature | Status |
|---|---|
| Category normalization (transactions) | ✅ Working |
| Budget amounts populated | ✅ Working |
| Splits route doesn't crash | ✅ Working |
| Budget field name (`amount` not `budget`) | ✅ Working |
| Transaction date filtering | ✅ Working |

## Still Broken / Pending

| Feature | Status |
|---|---|
| Merchant names | ❌ Null in DB — needs Plaid sync investigation |
| Splits amounts | ❌ `total_amount = 0` in DB — needs split creation fix |
| Splits direction | ✅ Fixed in MCP tool (Session 2) |
| Budget sign convention | ✅ Fixed in Session 2 |
| Budget category names | ✅ Fixed in Session 2 |
| Business entity routes (`/api/entities` etc.) | ❌ Not yet implemented |

---

## Next Session (Session 3) Goals

1. **Investigate merchant_name** — query luni_transactions in Supabase to confirm no rows have non-null merchant_name. If true, trace the Plaid sync to find where `merchant_name` should be written.
2. **Investigate total_amount = 0** — query luni_splits in Supabase to see raw data. Trace split creation code.
3. **Filter transfers from budget spend** — add `money_type != 'income'` and known transfer category exclusions to the budget calculation.
4. **Re-test all 3 calls** after fixes to validate.
5. **Begin business entity routes** — implement `GET /api/entities` so `list_entities` returns real data.
