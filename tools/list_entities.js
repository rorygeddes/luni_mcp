// tools/list_entities.js
//
// Returns the business entities (and personal spaces) the authenticated user
// is entitled to access. This is the gateway tool — Claude should call this
// first when the user asks about a business or when entity_id is needed for
// another tool.
//
// Privacy rule enforced in backend: the RLS policy on luni_entity_members
// ensures users only see entities they have an active membership in.
// Never trust an entity_id the client supplies without checking membership.
//
// Backend route: GET /api/entities

import { buildClient, formatBackendError } from "../client.js";
import { getJwt } from "../auth.js";

export const listEntities = {
  name: "list_entities",
  description:
    "List the business entities and personal spaces the authenticated user " +
    "has access to in Luni. Call this first when the user asks about a company, " +
    "partnership, or business account. The returned entity_id values are required " +
    "by get_cash_flow, get_pnl, get_recurring, and get_partner_distribution.",

  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["business", "personal", "all"],
        description:
          "'business' returns company/partnership spaces only. " +
          "'personal' returns the user's personal Luni space only. " +
          "'all' (default) returns both.",
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
      const params = {};
      if (args.type && args.type !== "all") params.type = args.type;

      const { data } = await client.get("/api/entities", { params });
      const entities = Array.isArray(data) ? data : data.entities ?? [];

      const compact = entities.map((e) => ({
        entity_id: e.id,
        name: e.name,
        type: e.type, // "business" | "personal"
        role: e.membership_role, // "owner" | "partner" | "viewer"
        currency: e.currency ?? "CAD",
        fiscal_year_start: e.fiscal_year_start ?? "01-01", // MM-DD
        created_at: e.created_at,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { count: compact.length, entities: compact },
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
