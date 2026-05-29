// tools/get_pnl.js
//
// Profit & Loss for a business entity: revenue vs expenses by category,
// with gross and net totals. Designed for questions like "What's Luni's
// P&L for May?" or "How profitable was Trillium in Q4?"
//
// This is the BI workhorse for consultancy-platform use cases — when
// a client connects Luni to Claude and asks "what did we make last quarter?"
// this is the tool that answers it.
//
// Backend route: GET /api/entities/:entity_id/pnl

import { buildClient, formatBackendError } from "../client.js";
import { getJwt } from "../auth.js";

export const getPnl = {
  name: "get_pnl",
  description:
    "Return the Profit & Loss statement for a business entity for a given " +
    "period. Shows revenue line items, expense categories, gross profit, and " +
    "net profit. Use this when the user asks about profitability, revenue, " +
    "operating expenses, or wants a P&L or income statement for a company. " +
    "Call list_entities first to get the entity_id.",

  inputSchema: {
    type: "object",
    required: ["entity_id"],
    properties: {
      entity_id: {
        type: "string",
        description: "The entity UUID from list_entities.",
      },
      period: {
        type: "string",
        description:
          "Shorthand period: 'this_month', 'last_month', 'this_quarter', " +
          "'last_quarter', 'ytd', 'last_year'. If omitted, use start_date/end_date.",
        enum: [
          "this_month",
          "last_month",
          "this_quarter",
          "last_quarter",
          "ytd",
          "last_year",
        ],
      },
      start_date: {
        type: "string",
        description:
          "Inclusive start, ISO-8601 (YYYY-MM-DD). Used when period is omitted.",
      },
      end_date: {
        type: "string",
        description:
          "Inclusive end, ISO-8601 (YYYY-MM-DD). Used when period is omitted.",
      },
      compare_to_previous: {
        type: "boolean",
        description:
          "If true, include a prior-period comparison column (same length, " +
          "immediately preceding the requested period). Useful for MoM/QoQ analysis.",
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
      const { entity_id, period, start_date, end_date, compare_to_previous } =
        args;

      const params = { period, start_date, end_date, compare_to_previous };
      Object.keys(params).forEach(
        (k) => params[k] === undefined && delete params[k]
      );

      const { data } = await client.get(`/api/entities/${entity_id}/pnl`, {
        params,
      });

      // Expected backend shape:
      // {
      //   entity_id, entity_name, currency,
      //   period: { start, end, label },
      //   revenue: [{ category, amount, prior_amount? }],
      //   expenses: [{ category, amount, prior_amount? }],
      //   gross_profit, gross_margin_pct,
      //   net_profit, net_margin_pct,
      //   prior_period?: { gross_profit, net_profit }
      // }
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: formatBackendError(err) }],
      };
    }
  },
};
