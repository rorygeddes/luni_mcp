// tools/list_splits_outstanding.js
//
// "Who owes me / what do I owe?" Unsettled splits for the authenticated user.
// Backend route: GET /api/splits?status=outstanding

import { buildClient, formatBackendError } from "../client.js";
import { getJwt } from "../auth.js";

export const listSplitsOutstanding = {
  name: "list_splits_outstanding",
  description:
    "List unsettled split transactions for the authenticated user. " +
    "Returns who owes the user money and who the user owes. Use this " +
    "for questions like 'who owes me', 'do I owe anyone', or 'how much " +
    "is outstanding from the Airbnb trip'.",

  inputSchema: {
    type: "object",
    properties: {
      friend_name_contains: {
        type: "string",
        description:
          "Optional case-insensitive substring filter on the other party's name.",
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
      const { data } = await client.get("/api/splits", {
        params: { status: "outstanding" },
      });
      const splits = Array.isArray(data) ? data : data.splits ?? [];

      const filter = (args.friend_name_contains ?? "").toLowerCase().trim();
      const match = (name) =>
        !filter || (name ?? "").toLowerCase().includes(filter);

      const owedToUser = [];
      const owedByUser = [];
      let totalOwedToUser = 0;
      let totalOwedByUser = 0;

      for (const s of splits) {
        // Backend returns: id, date, merchant, description, total_amount, you_are_payer, status
        const row = {
          split_id:    s.id,
          transaction: s.merchant || s.description,
          date:        s.date,
          amount:      Number(s.total_amount ?? 0),
          status:      s.status,
        };

        // friend_name_contains filter — match against description/merchant since we have no other_party_name
        if (!match(row.transaction)) continue;

        if (s.you_are_payer) {
          // current user paid — others owe the user
          owedToUser.push(row);
          totalOwedToUser += row.amount;
        } else {
          // someone else paid — user owes them
          owedByUser.push(row);
          totalOwedByUser += row.amount;
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                total_owed_to_user: round2(totalOwedToUser),
                total_owed_by_user: round2(totalOwedByUser),
                net: round2(totalOwedToUser - totalOwedByUser),
                owed_to_user: owedToUser,
                owed_by_user: owedByUser,
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

function round2(n) {
  return Math.round(n * 100) / 100;
}
