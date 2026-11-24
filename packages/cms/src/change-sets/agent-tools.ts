import type { AgentToolDefinition } from "@jini-ai/core";

/**
 * @file The Change Sets domain's agent-tool catalog (F7b option A, S6, 2026-09-24) —
 * `change_sets_list` + `change_sets_revert`, the agent-callable half of the admin Recovery page's
 * own change-set list/revert routes (`server/inbound/admin-http/routes/change-sets/list.ts`,
 * `.../revert.ts`).
 *
 * Scope, stated plainly because it is also this pass's own limit, not an oversight: a change set
 * exists today only for a post/page create/update/delete (`features/post/reverters.ts` registers
 * exactly `post/update` and `post/delete` into the shared `RevertRegistry`; nothing else in this
 * codebase writes a change-set row yet). So "undo" through these two tools covers post and page
 * edits and deletes — nothing wider. Both tool descriptions say this outright, so an agent does not
 * infer a general-purpose undo that does not exist. Deleted items have their OWN, more direct undo
 * (`trash_restore_item`, `features/trash/tool-registrations.ts`) — a change-set revert of a delete
 * would work too (the post reverter restores the row), but trash is the narrower, purpose-built
 * tool for "bring this back", so both descriptions point there instead of leaving an agent to
 * guess which one to reach for.
 *
 * `change_sets_revert` never accepts `force` — see Jini `@jini-ai/cms/core/commands` `revert.ts`'s own
 * `RevertChangeSetRequired.input.force` doc: an operator can explicitly click through a stale-
 * version conflict, but an agent principal is unconditionally forbidden from doing so
 * (`RevertForbiddenError`, `"AGENT_CANNOT_FORCE"`) the same way `gated-mutations/gateway.ts`'s
 * `confirm()` forbids an agent from forcing a plan through. Omitting the parameter from this
 * catalog's schema entirely (rather than accepting it and always sending `false`) makes that
 * refusal a shape fact a model can see up front, not a runtime surprise on the one call where it
 * tries `force: true`.
 *
 * Reversible in the ordinary case (a successful revert can itself be reverted — the revert is a new
 * change set's-worth of writes through the same forward save path each reverter uses), so per the
 * owner's standing rule it gets no confirm dialog — same posture `theme_set_active` and every other
 * reversible write in this codebase already has.
 *
 * How it relates to the project:
 * The server-side tool filter (ADR-014) consumes this catalog to decide which tool names an agent
 * session may even see; `authorize()` (ADR-021 §2) enforces the actual permission checks at call
 * time — this module only declares the catalog shape, it performs no I/O and no enforcement itself.
 */

/** Reused, not invented: the exact permission `change-sets/list.ts`'s admin route already checks. */
export const CHANGE_SET_READ_PERMISSION = "changeset.read";

/** Reused, not invented: the exact permission `change-sets/revert.ts`'s admin route already checks. */
export const CHANGE_SET_REVERT_PERMISSION = "changeset.revert";

/** Default rows `change_sets_list` returns when `limit` is omitted. */
export const CHANGE_SETS_DEFAULT_LIST_LIMIT = 20;

/** The most rows `change_sets_list` will ever return in one call, regardless of a larger `limit`. */
export const CHANGE_SETS_MAX_LIST_LIMIT = 100;

const LIST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [],
  properties: {
    limit: {
      type: "integer",
      minimum: 1,
      maximum: CHANGE_SETS_MAX_LIST_LIMIT, clamp: true,
      description: `Maximum rows to return, newest first. Default ${CHANGE_SETS_DEFAULT_LIST_LIMIT}, maximum ${CHANGE_SETS_MAX_LIST_LIMIT}.`,
    },
  },
} as const;

const REVERT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["changeSetId"],
  properties: {
    changeSetId: {
      type: "string",
      minLength: 1,
      description: "A change set's id, exactly as returned by change_sets_list.",
    },
  },
} as const;

/**
 * The Change Sets domain's fixed agent-tool catalog — see this file's header for the deliberate
 * scope limit (post/page create/update/delete only) and the deliberate absence of a `force` field.
 *
 * @complexity O(1) — a fixed, statically-defined list.
 */
export function getChangeSetsAgentToolCatalog(): AgentToolDefinition[] {
  return [
    {
      name: "change_sets_list",
      description:
        "Lists recent change sets for this workspace, newest first. Undo a matching recorded change. " +
        "Other changes are not listed here; deleted items come back through trash_restore_item. " +
        "Read-only. Use this to find a change set's id before calling change_sets_revert.",
      sideEffects: "none",
      authorization: { permission: CHANGE_SET_READ_PERMISSION },
      inputSchema: LIST_SCHEMA,
    },
    {
      name: "change_sets_revert",
      description:
        "Reverts one applied change set, undoing the post/page edit or delete it recorded. " +
        "Undo a matching recorded change. If a newer save blocks undo, explain the conflict and keep the newer version.",
      sideEffects: "mutates-durable-state",
      authorization: { permission: CHANGE_SET_REVERT_PERMISSION },
      inputSchema: REVERT_SCHEMA,
    },
  ];
}
