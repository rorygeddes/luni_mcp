// tools/list_transactions.js
//
// Read-only window into luni_transactions for the authenticated user.
// Personal finance only — for business-entity transactions use get_pnl
// or get_cash_flow with an entity_id.
//
// Backend route: GET /api/transactions

import { buildClient, formatBackendError } from "../client.js";
import { getJwt } from "../auth.js";

export const listTransactions = {
  name: "list_transactions",
  description:
    "List the user's personal Luni transactions. Use this whenever the user asks " +
    "about their own spending, recent purchases, a specific merchant, or a " +
    "category total. Returns transactions across all connected accounts (Plaid + " +
    "Wise) for the authenticated Luni user. " +
    "For business-entity spending, call get_pnl or get_cash_flow instead.",

  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "integer",
        description: "Max transactions to return (1–200). Default 50.",
        minimum: 1,
        maximum: 200,
      },
      start_date: {
        type: "string",
        description: "Inclusive lower bound, ISO-8601 date (YYYY-MM-DD).",
      },
      end_date: {
        type: "string",
        description: "Inclusive upper bound, ISO-8601 date (YYYY-MM-DD).",
      },
      category: {
        type: "string",
        description:
          "Filter to a single top-level category, e.g. 'Food & Drinks', " +
          "'Transportation', 'Bills & Utilities'. Case-sensitive.",
      },
      merchant_contains: {
        type: "string",
        description: "Case-insensitive substring match against merchant name.",
      },
      min_amount: {
        type: "number",
        description:
          "Filter to transactions with absolute value >= this amount (in dollars).",
      },
      money_type: {
        type: "string",
        description:
          "Filter by money type. Use 'spending' to show only real expenses (hides transfers, income, debt payments). " +
          "Other values: 'income', 'transfer', 'debt_payment'.",
        enum: ["spending", "income", "transfer", "debt_payment"],
      },
    },
    additionalProperties: false,
  },

  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },

  async handler(args, extra) {
    const jwt = await getJwt(extra);
    const client = buildClient(jwt);

    try {
      const params = {
        limit: args.limit ?? 50,
        start_date: args.start_date,
        end_date: args.end_date,
        category: args.category,
        merchant_contains: args.merchant_contains,
        min_amount: args.min_amount,
        money_type: args.money_type,
      };
      Object.keys(params).forEach(
        (k) => params[k] === undefined && delete params[k]
      );

      const { data } = await client.get("/api/transactions", { params });
      const transactions = Array.isArray(data) ? data : data.transactions ?? [];

      const compact = transactions.map((t) => ({
        id: t.id,
        date: t.date,
        merchant: t.merchant,        // backend maps merchant_name || display_name → 'merchant'
        amount: t.amount,
        category: t.category,
        subcategory: t.subcategory,
        pending: t.pending ?? false,
        split: t.split ?? false,     // backend returns 'split', not 'is_split'
        money_type: t.money_type,
        source: t.source,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { count: compact.length, transactions: compact },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: formatBackendError(err) }],
      };
    }
  },
};
