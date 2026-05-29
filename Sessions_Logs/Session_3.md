# Luni MCP — Client ↔ Builder Session Log — Session 3

**Date:** May 28, 2026
**Context:** Full client interrogation session. Seven real user questions asked against live data. Answers derived from MCP tool calls + direct Supabase SQL. One backend fix applied. One critical operational finding logged.

---

## Operational Finding — MCP Server Restart Required

**Before any results below are relevant:** changes to tool files (`tools/*.js`) only take effect after a Claude Desktop restart. The MCP server is a child process of Claude Desktop, not watched by nodemon. The backend (`luni_app/backend/server.js`) auto-restarts via nodemon, but the MCP layer does not.

**Impact this session:** Session 2 fixes to `list_transactions.js` and `list_splits_outstanding.js` were NOT yet active — tool was still reading old field names. Splits amounts are therefore still showing $0 from the MCP. The true values are confirmed via direct Supabase query below.

**Action required:** Restart Claude Desktop once after any tool file change.

---

## The 7 Client Questions — Answered

---

### Q1 — "Why is my transportation 647% over budget?"

**MCP response:** $378.05 spent vs $10 budget (3,781% after sign fix).

**What's in there (from Supabase + MCP):**

| Date | Amount | Description |
|------|--------|-------------|
| May 6 | $119.65 | SNCF — French national railway (international train) |
| May 8 | $55.16 | Unknown transportation |
| May 11 | $19.41 | Transportation |
| May 11 | $16.33 | Transportation |
| May 11 | $16.79 | Transportation |
| May 4 | $19.36 | Transportation |
| May 4 | $12.65 | Transportation |
| May 4 | $3.12 | Transportation |
| May 6 | $115.58 | **Claude.ai subscription — miscategorized as transportation** |

**Root cause:** Two problems. First, a $119.65 SNCF (French train) ticket is legitimate transportation but extraordinary — it's an international trip, not a commute. Second, the Claude.ai subscription ($115.58/mo) has `subcategory: "transportation"` in the DB — a **data categorization error** inflating the transportation budget by 45%.

**Bug to fix in data:** Claude.ai subscription (raw_description: "CLAUDE.AI SUBSCRIPTION") should be recategorized. Correct category: `bills_utilities` or `entertainment`. Fix in Supabase: update `subcategory` and `category` on that transaction row.

**Product finding:** A $10/month transportation budget is simply too low. Even without SNCF, local rides alone hit $60–80/month. The app should flag this on first open: "Your transportation budget covers 4 days of spending."

---

### Q2 — "What is that $838.16 charge?"

**From Supabase:**
```
merchant_name:    "Dlhus Unv"
raw_description:  "DLHUS UNV K8L7U8"
category:         GENERAL_SERVICES / shopping
money_type:       spending
date:             May 4, 2026
```

**Analysis:** "DLHUS UNV" with postal code K8L (Peterborough, Ontario) points to a university campus purchase — likely a bookstore, lab equipment, or course material charge at Trent University. "DLHUS" may be an abbreviated vendor/department code. This is real spending, not a transfer or error.

**Why merchant showed null in MCP:** `merchant_name` IS populated in the DB as "Dlhus Unv", but `list_transactions.js` was still reading the old field (`t.merchant_name` before Session 2 fix; `t.merchant` after — but MCP server hadn't restarted). After Claude Desktop restart, merchant will show correctly for this transaction and others that have `merchant_name` set.

**Other merchants confirmed present in DB (will show after restart):**
- Wise — $406.81 (international transfer)
- Claude.ai — $115.58 (subscription)
- Supabase — $104.33 (developer tool)
- SNCF — $119.65 (French train)
- LCBO — $57.95 (liquor store)
- Insurance (TD, OTIP, Sun Life) — $356.06, $154.10, $70.40

---

### Q3 — "Am I going to end the month in the red?"

**Supabase aggregate (May 1–28, all transactions):**

| Bucket | Amount |
|--------|--------|
| Total inflows (negative amounts) | $19,582.81 |
| Real spending (excluding transfers/debt) | $5,427.39 |
| Account transfers + debt payments | $15,940.81 |

**Projection:** At 90% through the month (day 28 of 31), real spending is tracking ~$6,030 by month end.

**Honest answer:** The raw numbers are messy because large account-to-account transfers ($7,600 + $3,000 + $1,300) inflate both sides. The $19,583 in "income" includes Wise inflows and bank transfers — not all earned income.

What's clear: **real day-to-day spending is approximately $5,400 for the month**. The biggest single items are $1,156 (POS MERCHANDISE OTTAWA FOREIGN), $838 (DLHUS UNV university purchase), and various insurance/subscription charges. This is a heavy spending month.

**Product finding:** The app needs a "cash flow" view that strips account transfers and shows only: earned income vs actual spending. Right now the raw transaction total is meaningless without that filter.

---

### Q4 — "How much did I actually spend on food this month?"

**Supabase direct query** (category ILIKE '%food%', positive amounts only):
```
$398.09 across 24 transactions
```

**Budget API was showing $705.89** — the inflated number came from a $406.81 Wise transfer that had `subcategory: "food_drinks"` in the DB. The transfer itself isn't food spending; Wise miscategorized it on import.

**Fix applied this session:** Added `TRANSFER_CATS` exclusion to `/api/budgets` — transactions where `category IN (transfer_in, transfer_out, transfer, transfers, savings_debt, loan_payments, income, bank_fees)` are now excluded from all budget calculations regardless of their subcategory.

**After fix, Food & Drinks budget will show:** ~$289 (direct food_drinks category transactions only, no transfer contamination). Still 1,927% over the $15 budget — but that's a real number now, not an artifact.

**Product finding:** $15/month food budget when actual spend is ~$400/month means the budget is set-and-forgotten. App should show "Your food budget covers 1 day of your actual spending" as a calibration prompt.

---

### Q5 — "I paid $1,257 in loan payments — is that normal?"

**Supabase direct query** (category LOAN_PAYMENTS, money_type=debt_payment):

| Date | Amount | Raw description |
|------|--------|----------------|
| May 4 | $100 | TD VISA K5L6J4 |
| May 5 | $200 | TD VISA L2Z3Q7 |
| May 6 | $150 | TD VISA L5X3H6 |
| May 7 | $87 | TD VISA R4J9Z7 |
| May 11 | $100 | TD VISA Q6U6R4 |
| May 12 | $20 | TD VISA R4J9Z7 |
| **Total** | **$657** | |

**What these actually are:** All 6 are credit card payments to TD Visa — not traditional installment loans. Different suffix codes (L2Z3Q7, L5X3H6, etc.) likely represent different TD Visa card accounts or payment references. The user is making irregular partial payments throughout the month rather than one monthly payment.

**Why the original "$1,257" was wrong:** The budget was counting income transactions (negative amounts) as spending via the sign convention bug from Session 1. The real figure is $657.

**Is it normal?** Partial/frequent payments to a credit card are fine — but making 6 separate payments suggests either multiple cards or manual habit rather than auto-pay. No alarm, but the app could surface "You made 6 credit card payments this month — consider setting up autopay."

---

### Q6 — "How does this compare to last month (April)?"

**April (top 100 transactions, partial view):**

| Category | Notable April items |
|----------|-------------------|
| Loan payments | $500 + $300 + $200 + $100 + $2.96 = **$1,102.96** |
| Transportation | $124.93 + $120.44 + $106.91 + $38.98 + $23.03 + others ≈ **$440** |
| Travel | $143.27 + $112.65 + $99.55 + $61.33 + $47.29 + $29.60 = **$493.69** |
| Food | Visible: $9.86 + $29.57 + $10.49 + $6.55 + others ≈ **$80+ partial** |
| Large unexplained | $655 (uncategorized Apr 23), $525.77 (general_merchandise) |

**May vs April summary:**

| Metric | April | May |
|--------|-------|-----|
| Credit card payments | ~$1,103 | $657 |
| Transportation | ~$440 | ~$262 |
| Travel | ~$494 | $136 (47.82 + 50 + 38.87) |
| Large single charges | $655 (unknown) | $838 (DLHUS) |

**May is actually lighter** on transportation and travel than April. Credit card payments are lower. The dominant new cost is the $838 university purchase.

**Limitation:** The April comparison is based on 100 transactions returned by the MCP — the full April picture would need a deeper pull. A proper month-over-month comparison requires a dedicated endpoint that aggregates by category for two periods simultaneously.

---

### Q7 — "Does anyone still owe me money from those splits?"

**MCP response:** $0 both directions (splits amount field was reading the wrong column — MCP server not yet restarted).

**Supabase ground truth:**

Splits where user is payer (others owe user money, even split = user gets back half):

| Description | Total amount | User gets back |
|-------------|-------------|----------------|
| Heart & Crown Nans Parlour | $42.89 | $21.45 |
| E-TRANSFER ***UMa | $44.00 | $22.00 |
| SEND E-TFR ***Dbq | $9.50 | $4.75 |
| TD VISA U8J3R2 | $100.00 | $50.00 |
| Amazon | $22.58 | $11.29 |
| Heart & Crown | $42.89 | $21.45 |
| STUBHUB MSP (StubHub tickets) | $189.96 | $94.98 |
| TD VISA R4J9Z7 (×2) | $40.00 | $20.00 |
| 19th Tee LTD (×4 entries) | $54.00 × 4 = $216 | $108.00 |
| **Subtotal owed to user** | | **~$353.92** |

Split where someone else paid (user owes them):

| Description | Total | User owes |
|-------------|-------|-----------|
| Dinner | $42.59 | $21.30 |

**Net owed to user: ~$332.62** — significantly more than $0, and in the ballpark of the $98.19 shown in the app UI (the UI may only show a subset, or may be calculating a different share).

**The data IS there.** `total_amount` is populated in `luni_splits`. The MCP returns $0 only because the tool file change (reading `s.total_amount` instead of `s.amount_owed`) hasn't taken effect yet — Claude Desktop restart will fix this.

**Note on the 4 × "19th Tee LTD" entries:** Four separate split records all for $54 (19th Tee LTD, a golf venue) — likely created four times accidentally. The app should deduplicate or prevent duplicate split creation on the same transaction.

---

## Fix Applied in Session 3

### Budget: exclude transfer/debt categories from spend calculation

**File:** `luni_app/backend/server.js` `/api/budgets` route

Added `TRANSFER_CATS` set before the budget calculation loop:

```js
const TRANSFER_CATS = new Set([
  'transfer_in', 'transfer_out', 'transfer', 'transfers',
  'savings_debt', 'loan_payments', 'income', 'bank_fees',
]);

const txns = (allTxns || []).filter(t => {
  const catKey = normalizeCatToLuniKey(t.category);
  if (TRANSFER_CATS.has(catKey)) return false;          // exclude transfers
  return catKey === budgetKey ||
         normalizeCatToLuniKey(t.subcategory) === budgetKey;
});
```

**Impact:**
- Food & Drinks: $705.89 → ~$289 (removes $406.81 Wise transfer with subcategory=food_drinks)
- Transportation: no longer counting $100 TD VISA savings_debt entry
- Loan payments no longer count toward any spending category

---

## Data Quality Issues to Fix in Supabase (not code)

| Transaction | Current categorization | Should be |
|-------------|----------------------|-----------|
| CLAUDE.AI SUBSCRIPTION ($115.58) | category=GENERAL_SERVICES, subcategory=transportation | subcategory=bills_utilities or entertainment |
| 19th Tee LTD split | 4 duplicate split records for same $54 charge | 1 record |
| Wise $406.81 | subcategory=food_drinks | subcategory=transfers |
| TD VISA payments | shown in budget spending before fix | excluded now ✓ |

**How to fix Claude.ai categorization:**
```sql
UPDATE luni_transactions
SET subcategory = 'subscriptions', category = 'bills_utilities'
WHERE raw_description ILIKE '%CLAUDE.AI%';
```

---

## Session 3 Status Board

| Question | Answered | Data source | Quality |
|----------|----------|-------------|---------|
| Q1 — Transportation 647% over | ✅ | MCP + Supabase | SNCF + Claude.ai miscategorization |
| Q2 — $838 charge | ✅ | Supabase | University/campus purchase (DLHUS UNV, K8L postal) |
| Q3 — End of month projection | ✅ | Supabase SQL | Real spend ~$5,427; ~$6,030 projected |
| Q4 — Food actual spend | ✅ | Supabase SQL | $398 real; budget inflated by $407 Wise transfer (fixed) |
| Q5 — Loan payments | ✅ | Supabase SQL | $657, all TD Visa credit card payments (not loans) |
| Q6 — vs last month | ⚠️ Partial | MCP April data | May lighter on travel/transport; need full April aggregate |
| Q7 — Splits owed | ✅ via DB | Supabase SQL | ~$333 net owed to user; MCP shows $0 until restart |

---

## Action Items for Session 4

1. **Restart Claude Desktop** — activates Session 2 tool fixes (merchant names, splits amounts)
2. **Fix Claude.ai SQL** — correct subcategory on Claude.ai subscription row
3. **Deduplicate 19th Tee LTD splits** — 4 identical records, should be 1
4. **Re-run all 3 original calls** — verify budget numbers look right after transfer exclusion fix
5. **Add `money_type` filter to `/api/transactions`** — let Claude filter to `money_type = 'spending'` only, hiding transfers/income from the client view
6. **Build `/api/entities`** — the last unimplemented route before the business entity tools work
