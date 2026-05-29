// tools/list_transactions.js
//
// Read-only window into luni_transactions for the authenticated user.
// Queries Supabase directly — no Express backend required.
// Personal finance only — for business-entity transactions use get_pnl
// or get_cash_flow with an entity_id.

import { buildSupabaseClient, normalizeCatToLuniKey } from "../client.js";
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
    const supabase = buildSupabaseClient(jwt);

    try {
      let query = supabase
        .from("luni_transactions")
        .select(
          "id, date, display_name, merchant_name, amount, category, subcategory, pending, source, is_split, money_type"
        )
        .eq("is_removed", false)           // RLS + auth.uid() handles user_id scoping
        .order("date", { ascending: false })
        .limit(Math.min(args.limit ?? 50, 200));

      if (args.start_date)        query = query.gte("date", args.start_date);
      if (args.end_date)          query = query.lte("date", args.end_date);
      if (args.category)          query = query.eq("subcategory", args.category);
      if (args.min_amount != null) query = query.gte("amount", args.min_amount);
      if (args.money_type)        query = query.eq("money_type", args.money_type);
      if (args.merchant_contains) {
        query = query.or(
          `merchant_name.ilike.%${args.merchant_contains}%,display_name.ilike.%${args.merchant_contains}%`
        );
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      const transactions = (data || []).map((t) => ({
        id:          t.id,
        date:        t.date,
        merchant:    t.merchant_name || t.display_name || null,
        amount:      t.amount,
        category:    normalizeCatToLuniKey(t.category),
        subcategory: normalizeCatToLuniKey(t.subcategory),
        pending:     t.pending ?? false,
        split:       t.is_split ?? false,
        money_type:  t.money_type,
        source:      t.source,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { count: transactions.length, transactions },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `Supabase error: ${err.message}` }],
      };
    }
  },
};
