import type { AgentToolDefinition as SharedAgentToolDefinition } from "@jini-ai/core";
import type { TrashEntityType } from "./ports.js";

/**
 * @file The Trash domain's agent-tool catalog: `trash_list_items` and `trash_restore_item`.
 *
 * Permanent removal belongs to a separate permanent-delete contributor and requires a human
 * confirmation. Admin routes and the retention sweeper retain their own permanent-removal
 * capability. A host's purge-ban test can ensure model-supplied confirmation cannot authorize that
 * service.
 *
 * A `trash_item` tool lives at the host's own post-processing seam and delegates to each domain's
 * built handler. A generic writer here would skip those domains' permission, confirmation and
 * transactional index gates. Delegation preserves those owners; this catalog itself lists and
 * restores.
 *
 * What this catalog owns is the half no domain owns: reading the Trash, and undoing a delete from it.
 *
 * The catalog is built from reachable kinds per call. A fixed enum would conceal live registry
 * kinds from the model even when list/restore handlers support them. buildTrashAgentToolCatalog
 * receives the same live kinds the host's policy uses for permission and restoration resolution.
 */

type AgentToolSideEffect = "none" | "mutates-durable-state" | "mints-token";

type AgentToolDefinition = SharedAgentToolDefinition & { sideEffects: AgentToolSideEffect };

function entityTypeProperty(kinds: readonly TrashEntityType[]) {
  return {
    type: "string",
    enum: [...kinds],
    description: "Which kind of thing this is, exactly as trash_list_items reported it.",
  } as const;
}

function listInputSchema(kinds: readonly TrashEntityType[]) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      entityTypes: {
        type: "array",
        items: entityTypeProperty(kinds),
        minItems: 1,
        description: "Optional filter. Omit it to see everything the caller is allowed to see.",
      },
      limit: { type: "integer", minimum: 1, maximum: 100, clamp: true, description: "Rows per page. Default 25." },
      cursor: {
        type: "string",
        minLength: 1,
        description: "The nextCursor from a previous call. Omit it for the first page.",
      },
    },
  } as const;
}

function restoreInputSchema(kinds: readonly TrashEntityType[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["entityType", "entityId"],
    properties: {
      entityType: entityTypeProperty(kinds),
      entityId: {
        type: "string",
        minLength: 1,
        description: "The entityId trash_list_items reported — the thing's own id, not the trash row's id.",
      },
    },
  } as const;
}

/**
 * Builds the two-tool catalog against `kinds` — every entity type the caller can currently list or
 * restore. Called fresh by `tool-registrations.ts` on each `buildTrashToolRegistrations`, with the
 * host policy's `catalogKinds()`, so the published enum always matches what the host's registry
 * actually holds that call.
 *
 * @complexity O(k) in `kinds.length` to build the two schemas.
 */
export function buildTrashAgentToolCatalog(kinds: readonly TrashEntityType[]): readonly AgentToolDefinition[] {
  return [
    {
      name: "trash_list_items",
      description:
        "Lists what is currently in the Trash — anything in the Trash: posts, pages, comments, media, redirects, " +
        "forms and submissions, widgets, menus, taxonomies and terms, plugins, themes, members; see the entityType enum for the " +
        "exact list — newest first. Each row reports trashItemId (pass it to trash_purge_item), entityType, entityId, the title as it was when it was " +
        "deleted, who deleted it, when, and the date it will be permanently removed automatically. Rows past " +
        "that date are already excluded. Restore anything listed here with trash_restore_item using entityType and entityId. Reading this " +
        "never touches the deleted thing itself, so it works even on items whose content is corrupt. Rows the " +
        "caller has no permission to restore are omitted. " +
        "Use trash_purge_item or trash_empty for permanent deletion if available to you; otherwise link /admin/trash. Secrets, credentials and MCP connections have no Trash screen. " +
        "Items here are removed automatically on the date shown.",
      sideEffects: "none",
      // The entry gate only. Each row is then filtered by the permission that would be needed to
      // restore THAT row's kind, so this never widens what a principal can see — see the policy's
      // `filterVisible` in `tool-registrations.ts`.
      authorization: { permission: "content.read" },
      inputSchema: listInputSchema(kinds),
    },
    {
      name: "trash_restore_item",
      description:
        "Takes one item back out of the Trash and makes it live again — anything in the Trash: posts, pages, " +
        "comments, media, redirects, forms and submissions, widgets, menus, taxonomies and terms, plugins, themes, members; see " +
        "the entityType enum for the exact list. Reversible — deleting it again puts it back. Returns " +
        "{ restored: true } on success. Returns restored:false with a reason when the item is not in the Trash " +
        "('not-found'), when it changed since it was deleted ('version-changed' — nothing was touched), or when " +
        "the plugin that owns that kind of thing is no longer installed ('adapter-unavailable'). " +
        "Use trash_purge_item or trash_empty for permanent deletion if available to you; otherwise link /admin/trash. Secrets, credentials and MCP connections have no Trash screen.",
      sideEffects: "mutates-durable-state",
      // Resolved per entity type at the handler; this declares the floor, and the handler checks the
      // permission that domain's own delete tool checked on the way in.
      authorization: { permission: "content.read" },
      inputSchema: restoreInputSchema(kinds),
    },
  ];
}
