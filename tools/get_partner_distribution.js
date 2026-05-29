// tools/get_partner_distribution.js
//
// Profit distribution summary for a business entity — how much of this
// period's net profit flows to each partner, per their split agreement.
//
// PRIVACY CRITICAL:
//   The backend must only return the calling user's own distribution slice
//   when the caller is a "partner" role. Full partner table (all names +
//   amounts) is only returned for "owner" role. This tool never bypasses
//   RLS; it simply surfaces whatever the backend returns for this JWT.
//
// Designed for: "How much do I take home from Luni this quarter?" or
// "Show me the profit split for Trillium in May."
//
// Backend route: GET /api/entities/:entity_id/distributions

import { buildClient, formatBackendError } from "../client.js";
import { getJwt } from "../auth.js";

export const getPartnerDistribution = {
  name: "get_partner_distribution",
  description:
    "Return the profit distribution summary for a business entity — how net " +
    "profit is split between partners for a given period. Partners see only " +
    "their own slice; owners see the full split. Use this when the user asks " +
    "'how much do I take home', 'what's my distribution', or 'show me the " +
    "partner split'. Call list_entities first to get the entity_id.",

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
        enum: [
          "this_month",
          "last_month",
          "this_quarter",
          "last_quarter",
          "ytd",
          "last_year",
        ],
        description: "Reporting period. Default: 'this_month'.",
      },
      start_date: {
        type: "string",
        description: "Inclusive start, ISO-8601 (YYYY-MM-DD). Used when period is omitted.",
      },
      end_date: {
        type: "string",
        description: "Inclusive end, ISO-8601 (YYYY-MM-DD). Used when period is omitted.",
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
      const { entity_id, period, start_date, end_date } = args;

      const params = { period: period ?? "this_month", start_date, end_date };
      Object.keys(params).forEach(
        (k) => params[k] === undefined && delete params[k]
      );

      const { data } = await client.get(
        `/api/entities/${entity_id}/distributions`,
        { params }
      );

      // Expected backend shape (partner-role caller):
      // {
      //   entity_id, entity_name, currency,
      //   period: { start, end, label },
      //   net_profit,          // entity total — always visible
      //   caller_role,         // "owner" | "partner"
      //   // partner role: only caller's slice
      //   my_split_pct,
      //   my_distribution_amount,
      //   // owner role: full table
      //   distributions?: [{ partner_name, split_pct, amount }]
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
