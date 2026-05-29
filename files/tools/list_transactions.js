// tools/list_transactions.js
//
// Read-only window into luni_transactions for the authenticated user.
// Mirrors GET /api/transactions in your backend, with a Claude-friendly
// shape (small flat objects, dates as ISO strings, amounts in major units).

import { buildClient, formatBackendError } from "../client.js";
import { getJwt } from "../auth.js";

export const listTransactions = {
  name: "list_transactions",
  description:
    "List the user's Luni transactions. Use this whenever the user asks " +
    "about spending, recent purchases, a specific merchant, or a category " +
    "total. Returns transactions across all connected accounts (Plaid + " +
    "Wise) for the authenticated Luni user.",

  // JSON Schema. Keep params optional and well-described — Claude reads
  // these descriptions to decide when to call the tool.
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
        description:
          "Inclusive lower bound, ISO-8601 date (YYYY-MM-DD). Omit for no lower bound.",
      },
      end_date: {
        type: "string",
        description:
          "Inclusive upper bound, ISO-8601 date (YYYY-MM-DD). Omit for no upper bound.",
      },
      category: {
        type: "string",
        description:
          "Filter to a single top-level category, e.g. 'Food & Drinks', " +
          "'Transportation', 'Bills & Utilities'. Case-sensitive; match your " +
          "Luni category names exactly.",
      },
      merchant_contains: {
        type: "string",
        description:
          "Case-insensitive substring match against the merchant name. " +
          "Useful for 'how much did I spend at X'.",
      },
      min_amount: {
        type: "number",
        description: "Filter to transactions with absolute value >= this amount (in dollars).",
      },
    },
    additionalProperties: false,
  },

  async handler(args, extra) {
    const jwt = getJwt(extra);
    const client = buildClient(jwt);

    try {
      const params = {
        limit: args.limit ?? 50,
        start_date: args.start_date,
        end_date: args.end_date,
        category: args.category,
        merchant_contains: args.merchant_contains,
        min_amount: args.min_amount,
      };
      // Strip undefineds so axios doesn't send empty params.
      Object.keys(params).forEach(
        (k) => params[k] === undefined && delete params[k]
      );

      const { data } = await client.get("/api/transactions", { params });

      // Your backend may already return this shape; if it returns a raw
      // array, drop the .transactions accessor. Adjust to match server.js.
      const transactions = Array.isArray(data) ? data : data.transactions ?? [];

      // Project to a compact shape — Claude does NOT need every Plaid field.
      const compact = transactions.map((t) => ({
        id: t.id,
        date: t.date,
        merchant: t.merchant_name ?? t.name,
        amount: t.amount,
        category: t.category,
        subcategory: t.subcategory,
        account: t.account_name,
        pending: t.pending ?? false,
        split: t.is_split ?? false,
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
