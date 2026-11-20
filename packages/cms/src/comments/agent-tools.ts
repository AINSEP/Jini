/**
 * @file The Comments agent-tool catalog, instantiating the
 * naming/callability convention for this domain — the same shape `forms/agent-tools.ts`
 * and `Jini packages/user-management/src/server/agent-tools.ts` use, including the `inputSchema` contract.
 *
 * Purpose:
 * A static, in-process catalog describing every agent-callable tool this domain exposes and the
 * permission each carries. Every entry maps 1:1 onto a real exported operation of
 * `write-service.ts` or `settings.ts` — this catalog never names an operation the domain cannot
 * perform.
 *
 * Deliberate absences (the point of a catalog, not an oversight):
 * - Permanent removal is exposed separately by `comments_purge_comment` in the human-confirmed
 *   `permanent-delete` contributor (owner Q1, 2026-10-01). This catalog owns reversible moderation;
 *   that contributor owns the confirmation card and `comments.delete.force` gate.
 * - No tool wraps `CommentIngressPolicy.submit` (the public visitor-submission path) or any
 *   spam-classifier feedback (`SpamCheckPort.report`) — those are not admin/operator surfaces at
 *   all, they are the anonymous-visitor ingress boundary and a classifier-training seam
 *   respectively; there is no "admin UI section" for either for this catalog to mirror.
 *
 * A residual risk worth naming rather than hiding: `Jini packages/user-management/src/server/agent-tools.ts`'s own header notes an
 * assistant is reachable by prompt injection through ordinary operator content, and names "a
 * comment" as the paradigmatic example. The moderation tools below (`approve`/`mark_spam`/`trash`/
 * `restore`) act on exactly that content. This catalog does not withhold them — moderating comments
 * IS the domain's core admin-UI functionality, every action here is reversible (trash <-> restore,
 * approve <-> mark_spam), and the permission gate a human moderator would need is the
 * identical gate a tool call must pass — but a reviewer should know the risk was considered, not
 * assume it wasn't. `purge` above is exactly the one action in this ladder where "reversible" stops
 * being true, which is why it alone is withheld.
 *
 * How it relates to the project:
 * `assistant/tool-registrations.ts` maps these entries into `@jini-ai/core` `ToolRegistration`s.
 * Unlike Forms/Identity, Comments' own write-service does NOT call `authorize()` internally
 * (`write-service.ts`'s file header: "Routes call authorize() first ... then this service, never
 * the repo directly") — so `tool-registrations.ts`'s handlers call `authorize()` explicitly,
 * mirroring the host admin routes for moderate, moderation-queue and get-settings byte for
 * byte, rather than relying on a self-enforcing domain function the way Forms/Identity do. See that
 * file's Comments section header for the full disclosure.
 *
 * Architectural role:
 * `comments` domain declaration. Imports only the constants its own domain already enforces
 * (`settings.ts`'s validation ceilings), so the published JSON Schemas cannot drift from the
 * validators. Performs no I/O and no enforcement itself.
 */

import type { AgentToolDefinition as SharedAgentToolDefinition } from "@jini-ai/core";
import { MAX_DEPTH_CEILING, MAX_PER_IP_PER_HOUR_CEILING } from "./settings-limits.js";
import { COMMENT_STATUSES } from "./types.js";

export type AgentToolSideEffect = "none" | "mutates-durable-state" | "mints-token";

export type AgentToolActorClassRule = "confirmer-must-equal-own-delegatedBy" | "user-only" | "none";

/**
 * JSON Schema for this tool's `input`, published to the model via `ToolDescriptor.inputSchema`
 * (`assistant/tool-registrations.ts`, which refuses to wire any tool lacking one).
 */
export type AgentToolDefinition = SharedAgentToolDefinition & { sideEffects: AgentToolSideEffect };

/** A comment's id, as returned by the moderation queue read's `items[].id`. */
const COMMENT_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  description: "The comment's id. Get it from {{read:comment_moderation_queue}}'s items[].id.",
} as const;

/** `expectedVersion` — every moderation-action tool takes this for optimistic concurrency (mirrors `CommentRecord.version`). */
const EXPECTED_VERSION_SCHEMA = {
  type: "integer",
  minimum: 0,
  description: "The comment's current version (CommentRecord.version), for optimistic concurrency. Read it first; a stale value is rejected rather than overwriting.",
} as const;

/** Optional moderator note shared by every moderation-action tool. */
const NOTE_SCHEMA = {
  type: ["string", "null"],
  description: "Optional moderator note recorded in the append-only moderation log. Omit or pass null for none.",
} as const;

/** The input shape shared by `approve`/`mark_spam`/`trash`/`restore` — exactly `{commentId, expectedVersion, note?}`. */
const MODERATION_ACTION_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["commentId", "expectedVersion"],
  properties: {
    commentId: COMMENT_ID_SCHEMA,
    expectedVersion: EXPECTED_VERSION_SCHEMA,
    note: NOTE_SCHEMA,
  },
} as const;

/** The input shape of the one no-argument read tool. */
const NO_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [],
  properties: {},
} as const;

const MUTATES_DURABLE_STATE = 'mutates-durable-state' as const;

/** Comments' fixed agent-tool catalog. */
export const commentsAgentToolCatalog: AgentToolDefinition[] = [
  {
    name: 'comments_get_provider', description: 'Read the active site comments provider, readiness, revision and pending stored count. Existing stored comments remain recoverable when disabled.',
    sideEffects: 'none', authorization: { permission: 'comments.configure' }, inputSchema: NO_INPUT_SCHEMA,
  },
  {
    name: 'comments_set_provider', description: 'Select built-in comments or disable public comments with null after a human confirmation card. Read comments_get_provider first for expectedRevision. Stored comments, settings and history are preserved.',
    sideEffects: MUTATES_DURABLE_STATE, authorization: { permission: 'comments.configure' },
    inputSchema: { type: 'object', additionalProperties: false, required: ['providerId', 'expectedRevision'], properties: {
      providerId: { type: ['string', 'null'], enum: ['built-in', null] }, expectedRevision: { type: 'integer', minimum: 0 },
    } },
  },
  {
    name: "comments_get_comment",
    description: "Reads one comment by id in any moderation status, including approved, spam and trash. Call when a queue page does not contain the comment you need. Returns {comment} with the same moderation view and version as the queue. Unknown ids and denied comments.read permission are refused.",
    sideEffects: "none", authorization: { permission: "comments.read" },
    inputSchema: { type: "object", additionalProperties: false, required: ["commentId"], properties: { commentId: COMMENT_ID_SCHEMA } },
  },
  {
    name: "comments_list_moderation_queue",
    description:
      "Lists comments filtered by moderation status (defaults to 'pending'), keyset-paginated. Read-only. Call this to find a comment's id and current version before approving, marking spam, trashing, or restoring it.",
    sideEffects: "none",
    authorization: { permission: "comments.read" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        status: {
          type: "string",
          enum: [...COMMENT_STATUSES],
          description: "Filter by moderation status. Defaults to 'pending' if omitted.",
        },
        limit: { type: "integer", minimum: 1, maximum: 100, clamp: true, description: "Max rows to return (1-100). Defaults to 20." },
        cursor: { type: "string", description: "Opaque keyset cursor from a previous call's nextCursor. Omit for the first page." },
      },
    },
  },
  {
    name: "comments_get_settings",
    description: "Reads the workspace's 6 comments.* settings (enabled, requireModeration, maxDepth, closeAfterDays, spamAutoRejectScore, maxPerIpPerHour). Read-only.",
    sideEffects: "none",
    authorization: { permission: "comments.configure" },
    inputSchema: NO_INPUT_SCHEMA,
  },
  {
    name: "comments_update_settings",
    description:
      "Updates one or more of the workspace's comments.* settings. A partial patch — omitted fields are left unchanged. At least one field must be supplied.",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: "comments.configure" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        enabled: { type: "boolean", description: "Master on/off switch for accepting new comments." },
        requireModeration: { type: "boolean", description: "Whether new comments start 'pending' (true) or 'approved' (false)." },
        maxDepth: { type: "integer", minimum: 0, maximum: MAX_DEPTH_CEILING, description: `Max threading depth (0-${MAX_DEPTH_CEILING}).` },
        closeAfterDays: {
          type: ["integer", "null"],
          minimum: 0,
          description: "Close submissions on entries older than N days. null means never closes.",
        },
        spamAutoRejectScore: { type: "number", minimum: 0, maximum: 1, description: "Score threshold in [0,1] above which ingress auto-classifies a submission as spam." },
        maxPerIpPerHour: {
          type: "integer",
          minimum: 1,
          maximum: MAX_PER_IP_PER_HOUR_CEILING,
          description: `Max submissions per IP-hash per rolling hour (1-${MAX_PER_IP_PER_HOUR_CEILING}).`,
        },
      },
    },
  },
  {
    name: "comments_approve_comment",
    description: "Approves a pending (or previously spam/trashed) comment, making it publicly visible. Reversible via comments_mark_comment_spam, comments_trash_comment, or comments_restore_comment.",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: "comments.moderate" },
    inputSchema: MODERATION_ACTION_INPUT_SCHEMA,
  },
  {
    name: "comments_mark_comment_spam",
    description: "Marks a comment as spam, hiding it from public view. Reversible via comments_approve_comment or comments_restore_comment.",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: "comments.moderate" },
    inputSchema: MODERATION_ACTION_INPUT_SCHEMA,
  },
  {
    name: "comments_trash_comment",
    description:
      "Soft-deletes a comment (trash), hiding it from public view. This is NOT permanent — a trashed comment can be brought back with comments_restore_comment. For permanent removal, use comments_purge_comment if it is available to you; it waits for a human confirmation card. Otherwise link the human to /admin/trash.",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: "comments.delete" },
    inputSchema: MODERATION_ACTION_INPUT_SCHEMA,
  },
  {
    name: "comments_restore_comment",
    description: "Restores a trashed or spam comment back to approved and publicly visible. The v1 restore ladder always targets 'approved', regardless of which status the comment was previously in.",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: "comments.moderate" },
    inputSchema: MODERATION_ACTION_INPUT_SCHEMA,
  },
];
