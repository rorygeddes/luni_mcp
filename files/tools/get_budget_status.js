// tools/get_budget_status.js
//
// "How am I doing this month?" Mirrors GET /api/budgets, joined against
// month-to-date spend. Returns one row per budget category with the
// budget amount, spent so far, remaining, and a simple pace flag.

import { buildClient, formatBackendError } from "../client.js";
import { getJwt } from "../auth.js";

export const getBudgetStatus = {
  name: "get_budget_status",
  description:
    "Show the user's budget vs actual spend for the current month (or a " +
    "specified month). Use this when the user asks 'how am I doing', " +
    "'am I over budget', 'which categories am I over on', or similar.",

  inputSchema: {
    type: "object",
    properties: {
      month: {
        type: "string",
        description:
          "Month to report on, YYYY-MM. Defaults to the current month.",
        pattern: "^\\d{4}-\\d{2}$",
      },
    },
    additionalProperties: false,
  },

  async handler(args, extra) {
    const jwt = getJwt(extra);
    const client = buildClient(jwt);

    try {
      const month = args.month ?? currentMonthYYYYMM();
      const { data } = await client.get("/api/budgets", { params: { month } });

      const budgets = Array.isArray(data) ? data : data.budgets ?? [];

      // Compute pace: where in the month are we, vs where the spend is.
      // Cheap heuristic — your backend may already return this; if so,
      // pass it through instead.
      const today = new Date();
      const [year, mon] = month.split("-").map(Number);
      const daysInMonth = new Date(year, mon, 0).getDate();
      const dayOfMonth =
        today.getFullYear() === year && today.getMonth() + 1 === mon
          ? today.getDate()
          : daysInMonth;
      const monthProgress = dayOfMonth / daysInMonth;

      const rows = budgets.map((b) => {
        const spent = Number(b.spent ?? 0);
        const budget = Number(b.amount ?? 0);
        const remaining = budget - spent;
        const expectedByNow = budget * monthProgress;
        let pace;
        if (budget === 0) pace = "no_budget_set";
        else if (spent > budget) pace = "over";
        else if (spent > expectedByNow * 1.15) pace = "ahead_of_pace";
        else if (spent < expectedByNow * 0.5) pace = "underspending";
        else pace = "on_track";

        return {
          category: b.category,
          budget,
          spent,
          remaining,
          pct_used: budget > 0 ? Math.round((spent / budget) * 100) : null,
          pace,
        };
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                month,
                day_of_month: dayOfMonth,
                days_in_month: daysInMonth,
                month_progress_pct: Math.round(monthProgress * 100),
                categories: rows,
              },
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

function currentMonthYYYYMM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
