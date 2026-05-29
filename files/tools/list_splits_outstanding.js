// tools/list_splits_outstanding.js
//
// "Who owes me / what do I owe?" Reads from your splits endpoints.
// Returns two arrays — owed_to_user and owed_by_user — each with the
// friend name, transaction summary, and amount.

import { buildClient, formatBackendError } from "../client.js";
import { getJwt } from "../auth.js";

export const listSplitsOutstanding = {
  name: "list_splits_outstanding",
  description:
    "List unsettled split transactions for the authenticated user. " +
    "Returns who owes the user money and who the user owes. Use this " +
    "for questions like 'who owes me', 'do I owe anyone', 'how much " +
    "is outstanding from the Airbnb trip'.",

  inputSchema: {
    type: "object",
    properties: {
      friend_name_contains: {
        type: "string",
        description:
          "Optional case-insensitive substring filter on the other party's name. " +
          "Use when the user asks about one specific friend.",
      },
    },
    additionalProperties: false,
  },

  async handler(args, extra) {
    const jwt = getJwt(extra);
    const client = buildClient(jwt);

    try {
      // Your backend exposes these via the social/split routes. If the
      // exact path differs, adjust here — we don't change the backend.
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
        const row = {
          split_id: s.id,
          transaction: s.transaction_description ?? s.merchant_name,
          date: s.date,
          friend: s.other_party_name,
          amount: Number(s.amount_owed ?? 0),
        };

        if (!match(row.friend)) continue;

        // Convention: positive when friend owes user, negative when user owes friend.
        // Adjust the sign check to match how your backend encodes it.
        if (s.direction === "incoming" || row.amount > 0) {
          owedToUser.push(row);
          totalOwedToUser += Math.abs(row.amount);
        } else {
          owedByUser.push({ ...row, amount: Math.abs(row.amount) });
          totalOwedByUser += Math.abs(row.amount);
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
