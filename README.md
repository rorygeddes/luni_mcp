# Luni MCP Server

This folder is the MCP (Model Context Protocol) server for Luni Financial. It lets Claude read live data from Luni — transactions, budgets, business P&L, recurring revenue, partner distributions — by connecting Claude directly to the Luni backend API.

When someone adds the Luni connector to Claude, this is what runs underneath it.

---

## What this is, in plain English

Claude can't access your database on its own. This server acts as a secure bridge: Claude asks a question, the MCP server translates it into an API call to your existing Luni backend, and returns the answer in a shape Claude can reason about.

The server holds **no secrets**. It doesn't touch Plaid, Supabase, or Wise directly — it just forwards the user's authentication token to your backend, which already has all the access control logic. If a user isn't allowed to see something in the Luni app, they can't see it through Claude either.

---

## Folder structure

```
Luni_MCP/
├── server.js                        Entry point. Registers all tools and starts the server.
├── auth.js                          Figures out which user's token to use on each request.
├── client.js                        Thin wrapper that calls your Express backend with that token.
├── package.json                     Dependencies and scripts.
│
├── tools/
│   ├── list_transactions.js         Personal spending history (Plaid + Wise accounts).
│   ├── get_budget_status.js         Personal budget vs. actual spend for the month.
│   ├── list_splits_outstanding.js   Who owes the user money, and vice versa.
│   ├── list_entities.js             Which businesses and personal spaces the user has access to.
│   ├── get_cash_flow.js             Cash in vs. cash out for a business entity.
│   ├── get_pnl.js                   Profit & Loss statement for a business entity.
│   ├── get_recurring.js             Recurring income and expenses (subscriptions, retainers, etc.).
│   └── get_partner_distribution.js  How net profit is split between partners.
│
└── remote/
    └── vercel-handler.js            Skeleton for the future public/hosted version of this server.
```

---

## The tools — what each one does

### Personal finance tools (3)

**`list_transactions`**
Returns the user's transactions across all connected accounts. Claude uses this when someone asks "what did I spend on food last week?" or "show me all transactions over $200 in April." Supports filters by date range, category, merchant name, and minimum amount.

**`get_budget_status`**
Shows how the user is tracking against their personal budgets for a given month. Returns each category with the budget amount, how much has been spent, what's left, and a pace flag (on_track / over / ahead_of_pace / underspending). Claude uses this when someone asks "how am I doing this month?" or "which categories am I over on?"

**`list_splits_outstanding`**
Lists unresolved split transactions — who owes the user money and who the user owes. Returns totals and per-split detail. Claude uses this when someone asks "who owes me?" or "what do I owe from the Vegas trip?"

---

### Business entity tools (5) — the BI/consultancy layer

These are the new tools added in v0.2.0. They work at the business level, not the personal level, and all require an `entity_id` (retrieved via `list_entities`).

**`list_entities`**
The gateway tool. Returns every business entity and personal space the authenticated user is entitled to see — company name, their role (owner / partner / viewer), currency, and fiscal year start. Claude calls this first whenever the user asks about a company. The backend enforces row-level security so users only see entities they actually belong to.

**`get_cash_flow`**
Total money in vs. money out for a business entity over a date range. Can be broken down month by month, by expense/income category, or returned as a single totals summary. Claude uses this when someone asks "what was our cash flow in Q1?" or "show me the monthly cash position for last year."

**`get_pnl`**
A full Profit & Loss statement for a business entity. Shows revenue line items, expense categories, gross profit, and net profit. Supports shorthand periods (this_month, last_quarter, ytd, last_year) and an optional prior-period comparison column for month-over-month or quarter-over-quarter analysis. This is the main tool a Luni Business client would use when they ask Claude "how profitable were we in Q4?"

**`get_recurring`**
Lists all recurring inflows and outflows for a business entity — retainer income, SaaS subscriptions, recurring vendor payments, etc. Returns the monthly total for each, an annualised value, and a net monthly recurring summary. Claude uses this when someone asks "what are our fixed monthly costs?" or "show me all our recurring revenue."

**`get_partner_distribution`**
Shows how the entity's net profit is split between partners for a period. This tool is privacy-aware by design: if the caller is a partner, the backend only returns their own slice (their percentage and dollar amount). If the caller is an owner, it returns the full table. Claude uses this when someone asks "how much do I take home this quarter?" or "show me the partner split."

---

## How it works right now (local / v1)

The server runs locally on your machine, started by Claude Desktop as a subprocess. Claude Desktop reads the configuration below, spawns `node server.js`, and communicates with it over stdin/stdout.

**Setup:**

```bash
cd Luni_MCP
npm install
```

Make sure your backend is running (`npm run dev` in the backend folder).

Get a JWT for the user you want Claude to act as. The easiest way: sign in to the Luni app and copy `currentSession.accessToken` from the Supabase auth session. In Supabase → Authentication → Settings, set JWT Expiry to something like 86400 (24 hours) during development so you're not re-pasting every hour.

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "luni": {
      "command": "node",
      "args": ["/absolute/path/to/Luni_MCP/server.js"],
      "env": {
        "LUNI_BACKEND_URL": "http://localhost:3000",
        "LUNI_JWT": "eyJhbGciOiJIUzI1NiIs..."
      }
    }
  }
}
```

Restart Claude Desktop. You'll see a plug icon in Claude showing the Luni tools are connected. Try:

- "What did I spend on restaurants this month?"
- "How am I doing on my budgets?"
- "What's Luni Financial's P&L for May?"
- "Show me our recurring expenses."

---

## Backend routes you need to implement

The three personal-finance tools already have matching routes in the backend. The five new business entity tools expect these routes — they need to be added to `backend/server.js`:

| Tool | Route | Notes |
|---|---|---|
| `list_entities` | `GET /api/entities` | Filter by `?type=business\|personal`. RLS must scope to user's memberships. |
| `get_cash_flow` | `GET /api/entities/:id/cash-flow` | Params: `start_date`, `end_date`, `group_by` (month / category / none). |
| `get_pnl` | `GET /api/entities/:id/pnl` | Params: `period`, `start_date`, `end_date`, `compare_to_previous`. |
| `get_recurring` | `GET /api/entities/:id/recurring` | Params: `direction` (inflow / outflow / all), `status` (active / all). |
| `get_partner_distribution` | `GET /api/entities/:id/distributions` | Params: `period`, `start_date`, `end_date`. Must return only caller's slice for partner role. |

The privacy rule for `get_partner_distribution` is the critical one: the RLS policy (or verifyToken middleware) must check the caller's role on the entity and scope the response accordingly — partner sees only their own row, owner sees all rows.

---

## What the tools tell Claude about themselves

Each tool carries annotations that describe its behaviour to Claude and to Anthropic's connector directory reviewers:

```js
annotations: {
  readOnlyHint: true,      // this tool never writes or modifies data
  destructiveHint: false,  // it cannot delete anything
  openWorldHint: false,    // it only accesses Luni data, not the open internet
}
```

All eight tools are read-only. Future write tools (categorise a transaction, create a split, etc.) will carry `readOnlyHint: false` plus a required `confirm: true` parameter that forces the user to explicitly approve the action in chat before anything is written.

---

## How authentication works

**Right now (v1):** You paste a Supabase JWT into the config file. `auth.js` reads it from the `LUNI_JWT` environment variable and attaches it to every API call.

**When this goes public (v2):** Claude will initiate an OAuth 2.1 / PKCE flow. The user clicks "Connect Luni" in Claude, logs in to their Luni account, and approves the connection. Claude gets back a short-lived bearer token, which `auth.js` exchanges for a Supabase JWT via a new backend route (`POST /oauth/token-exchange`). The token cache in `auth.js` means this exchange only happens once per session, not on every tool call.

The OAuth branch is already stubbed in `auth.js` — it's waiting for the Vercel transport and OAuth backend routes to be wired in.

---

## The roadmap to a public connector

Getting from "works for me locally" to "anyone can add Luni in Claude" has four steps:

**Step 1 — Implement the backend routes** listed in the table above. This makes the five business entity tools actually work.

**Step 2 — Deploy the remote transport.** Replace the stdio transport in `server.js` with an SSE transport, expose it as a Vercel function. The skeleton is in `remote/vercel-handler.js`. The tool files don't change at all — only the transport layer changes.

**Step 3 — Add OAuth to the backend.** Four new routes in `backend/server.js`:
- `GET /.well-known/oauth-authorization-server` — tells Claude where to authenticate
- `GET /oauth/authorize` — redirect to Luni login
- `POST /oauth/token` — exchange code for access token
- `POST /oauth/token-exchange` — exchange MCP bearer for Supabase JWT

**Step 4 — Publish.** For private clients (like Trillium), give them the MCP server URL and they add it as a custom connector in Claude — no review needed. For a public listing in Anthropic's connector directory, submit through their review form and allowlist these two OAuth redirect URIs:
- `https://claude.ai/api/mcp/auth_callback`
- `https://claude.com/api/mcp/auth_callback`

---

## What this server deliberately does NOT do

- **No write operations.** Nothing in this server can modify, delete, or create data in Luni. Every tool is read-only.
- **No raw database access.** The server never touches Supabase, Plaid, or Wise directly. It only calls the Luni Express backend, which already has all access control logic.
- **No secrets stored here.** No Plaid client ID, no Supabase service-role key, nothing sensitive. The JWT lives in the user's local config file and is never logged or stored by this server.
- **No QuickBooks, Stripe, or calendar tools.** Those belong in their own connectors. This server is the Luni-data layer only.
