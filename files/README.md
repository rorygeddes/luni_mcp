# luni-mcp

MCP server that exposes Luni Financial data to Claude Desktop (and later, to
remote Claude clients via OAuth).

Sits **next to** `backend/`, not inside it. It calls the existing Express API
over HTTP with the user's Supabase JWT, so all your RLS, `verifyToken`, and
Plaid/Wise/OpenAI logic keep working exactly as they do for the Flutter app.
The MCP server holds **no secrets** — not the Plaid client ID, not the Supabase
service-role key, nothing. It's a translator.

```
luni_app/
├── backend/      ← unchanged
└── mcp/          ← this folder
    ├── server.js              entry point, registers tools, stdio transport
    ├── client.js              axios wrapper, forwards user JWT to backend
    ├── auth.js                resolves which JWT to use for the current call
    ├── tools/
    │   ├── list_transactions.js
    │   ├── get_budget_status.js
    │   └── list_splits_outstanding.js
    └── package.json
```

## Setup (local, ~5 min)

```bash
cd luni_app/mcp
npm install
```

Make sure your backend is running on its usual port (`cd backend && npm run dev`).

Grab a JWT for the user you want Claude to act as. The cheapest way: sign in
to the Luni app as that user, then in the Flutter app's debug console print
`Supabase.instance.client.auth.currentSession?.accessToken`. Copy the string.

> Heads-up: default Supabase JWT TTL is 1 hour. For dev you can bump
> `JWT expiry` in **Supabase → Authentication → Settings** to something
> longer (e.g. 24h) so you're not re-pasting all day. For production /
> customers, the OAuth flow (v2) replaces this entirely — see below.

Open `~/Library/Application Support/Claude/claude_desktop_config.json` and add:

```json
{
  "mcpServers": {
    "luni": {
      "command": "node",
      "args": ["/absolute/path/to/luni_app/mcp/server.js"],
      "env": {
        "LUNI_BACKEND_URL": "http://localhost:3000",
        "LUNI_JWT": "eyJhbGciOiJIUzI1NiIs..."
      }
    }
  }
}
```

Restart Claude Desktop. You should see a 🔌 indicator showing 3 Luni tools
available. Then try:

- *"What did I spend on food last week?"*
- *"How am I doing on my budgets this month?"*
- *"Who owes me money?"*

If something breaks, check Claude Desktop's MCP logs (Settings → Developer →
Open MCP Logs). The `[luni-mcp]` startup line on stderr confirms it spawned.

## Wiring the tools to your real endpoints

The tools are written against your documented routes in
`LUNI_APP_ARCHITECTURE.md`:

- `list_transactions` → `GET /api/transactions`
- `get_budget_status` → `GET /api/budgets`
- `list_splits_outstanding` → `GET /api/splits` (adjust path if yours differs)

Two things to check against the actual `backend/server.js` before this works
end-to-end:

1. **Response shape.** Each tool projects backend fields into a compact shape
   for Claude. If your `/api/transactions` returns rows under a different key
   (e.g. `data.rows` instead of `data.transactions`), update the destructure
   at the top of the tool's handler.
2. **Splits endpoint name.** If you used a different path or nest splits
   under `/api/groups/:id/splits`, change the URL in
   `tools/list_splits_outstanding.js`. Everything else (filtering, totals,
   sign convention) stays the same.

## v2: remote MCP server + OAuth

Path to ship this to customers:

1. **Move transport to HTTP + SSE.** Replace `StdioServerTransport` in
   `server.js` with the SSE transport, expose it as a Vercel function at
   `mcp.luni.ca/sse`. The tool files don't change.
2. **Add an OAuth provider on the backend.** New routes in `server.js`:
   `GET /oauth/authorize`, `POST /oauth/token`, `POST /oauth/refresh`.
   These trade Luni login for short-lived access tokens scoped to a single
   user (or a single Luni Business space).
3. **Update `auth.js`.** Add a `resolveJwtFromOAuth(extra)` branch — read
   the bearer from `extra.authInfo`, swap it for a Supabase session JWT via
   the backend, cache for its TTL.
4. **Publish to the Claude connector directory** (eventually), or have
   customers paste your URL into "Add custom connector".

Until then, local stdio is the right shape — it's how you'll test against
Trillium in a few weeks without bottlenecking on the OAuth implementation.

## What this server deliberately does NOT do (yet)

- **No write tools.** No `categorize_transaction`, no `create_split`, no
  `update_budget`. Write tools are easy to add (same pattern), but every
  write tool needs an explicit confirmation parameter the user has to
  approve in chat — Claude can be steered by malicious content in
  transaction memos otherwise.
- **No rate limiting.** Your backend should grow a per-JWT rate limit
  (60/min is a reasonable start) before this server is exposed beyond you
  and Trillium.
- **No QuickBooks / Stripe / Calendar tools.** Those belong in a separate
  MCP server (or, more likely, your customers connect those directly to
  Claude). This server is the Luni-data side of the equation.
