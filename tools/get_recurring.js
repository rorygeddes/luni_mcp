// tools/get_recurring.js
//
// Recurring inflows and outflows for a business entity — subscriptions,
// retainers, recurring revenue, regular vendor payments. Designed for
// questions like "What are our fixed monthly costs?" or "Show me all
// our recurring revenue streams."
//
// This feeds the Quarterly Partnership Review cadence (recurring-revenue
// alerting) and is one of the highest-signal BI tools for a consultancy
// client asking "what can we count on every month?"
//
// Backend route: GET /api/entities/:entity_id/recurring

import { buildClient, formatBackendError } from "../client.js";
import { getJwt } from "../auth.js";

export const getRecurring = {
  name: "get_recurring",
  description:
    "List recurring inflows and outflows for a business entity: subscriptions, " +
    "retainers, recurring revenue, and regular vendor payments. Use this when " +
    "the user asks about fixed costs, recurring revenue, SaaS spend, or wants " +
    "to know what the business can count on month to month. " +
    "Call list_entities first to get the entity_id.",

  inputSchema: {
    type: "object",
    required: ["entity_id"],
    properties: {
      entity_id: {
        type: "string",
        description: "The entity UUID from list_entities.",
      },
      direction: {
        type: "string",
        enum: ["inflow", "outflow", "all"],
        description:
          "'inflow' = recurring revenue/income only. " +
          "'outflow' = recurring expenses only. " +
          "'all' (default) = both.",
      },
      status: {
        type: "string",
        enum: ["active", "paused", "cancelled", "all"],
        description: "Filter by recurring item status. Default: 'active'.",
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
      const { entity_id, direction = "all", status = "active" } = args;

      const params = { direction, status };

      const { data } = await client.get(
        `/api/entities/${entity_id}/recurring`,
        { params }
      );

      const items = Array.isArray(data) ? data : data.recurring ?? [];

      const compact = items.map((r) => ({
        id: r.id,
        name: r.name ?? r.merchant_name,
        direction: r.direction, // "inflow" | "outflow"
        amount: Number(r.amount),
        frequency: r.frequency, // "monthly" | "annual" | "weekly" | etc.
        next_date: r.next_date,
        category: r.category,
        status: r.status,
        annual_value: annualise(Number(r.amount), r.frequency),
      }));

      const totalInflow = compact
        .filter((r) => r.direction === "inflow")
        .reduce((s, r) => s + r.amount, 0);
      const totalOutflow = compact
        .filter((r) => r.direction === "outflow")
        .reduce((s, r) => s + r.amount, 0);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                entity_id,
                monthly_recurring_inflow: round2(totalInflow),
                monthly_recurring_outflow: round2(totalOutflow),
                monthly_recurring_net: round2(totalInflow - totalOutflow),
                count: compact.length,
                items: compact,
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

/** Normalise any frequency to a monthly amount for easy comparison. */
function annualise(amount, frequency) {
  switch (frequency) {
    case "weekly":
      return round2(amount * 52);
    case "biweekly":
      return round2(amount * 26);
    case "monthly":
      return round2(amount * 12);
    case "quarterly":
      return round2(amount * 4);
    case "annual":
    case "yearly":
      return round2(amount);
    default:
      return null;
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
