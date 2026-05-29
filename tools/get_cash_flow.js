// tools/get_cash_flow.js
//
// Cash flow summary for a business entity: total inflows, total outflows,
// net, and a breakdown by top-level category or month. Designed for
// questions like "What was Luni's cash flow in Q1?" or "Show me the
// month-by-month cash position for Trillium in 2025."
//
// Privacy: the backend enforces that entity_id belongs to this user before
// returning data. No client-side entity_id filtering here.
//
// Backend route: GET /api/entities/:entity_id/cash-flow

import { buildClient, formatBackendError } from "../client.js";
import { getJwt } from "../auth.js";

export const getCashFlow = {
  name: "get_cash_flow",
  description:
    "Return the cash flow summary for a business entity: inflows, outflows, " +
    "net, and a breakdown by category or by month. Use this when the user asks " +
    "about revenue vs expenses, monthly cash position, or how much money came " +
    "in/went out of a company. Call list_entities first to get the entity_id.",

  inputSchema: {
    type: "object",
    required: ["entity_id"],
    properties: {
      entity_id: {
        type: "string",
        description: "The entity UUID from list_entities.",
      },
      start_date: {
        type: "string",
        description: "Inclusive start, ISO-8601 date (YYYY-MM-DD). Required.",
      },
      end_date: {
        type: "string",
        description:
          "Inclusive end, ISO-8601 date (YYYY-MM-DD). Defaults to today.",
      },
      group_by: {
        type: "string",
        enum: ["month", "category", "none"],
        description:
          "'month' returns one row per calendar month. " +
          "'category' returns one row per expense/income category. " +
          "'none' (default) returns a single totals object.",
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
      const { entity_id, start_date, end_date, group_by = "none" } = args;

      const params = { start_date, end_date, group_by };
      Object.keys(params).forEach(
        (k) => params[k] === undefined && delete params[k]
      );

      const { data } = await client.get(
        `/api/entities/${entity_id}/cash-flow`,
        { params }
      );

      // Expected backend shape:
      // {
      //   entity_id, entity_name, period: { start, end },
      //   total_inflows, total_outflows, net,
      //   currency,
      //   breakdown: [{ label, inflows, outflows, net }]   // if group_by != "none"
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
