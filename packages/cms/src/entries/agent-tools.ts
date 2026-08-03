/**
 * @file The Entries agent-tool catalog — this domain's instance of the per-domain `agent-tools.ts`
 * convention `features/content-types/agent-tools.ts`, `features/settings/agent-tools.ts`, and every
 * other domain catalog already use (ADR-049 Decision 4).
 *
 * Purpose:
 * A static, in-process catalog describing every agent-callable tool this domain exposes. Every
 * entry maps 1:1 onto a real exported function of `features/entries/write-service.ts` (`createEntry`,
 * `updateEntry`, `publishEntry`, `unpublishEntry`) or `features/entries/list.ts` (`listEntries`) —
 * this catalog never names an operation the domain cannot perform.
 *
 * Naming and scope — a real discrepancy from this dispatch's own brief, disclosed rather than
 * silently reconciled: the brief framed this domain as "backing the Pages, Posts, and Collections
 * admin sections", but reading the actual admin routes shows that is only true for Collections.
 * `server/routes/admin/entries/{create,update,lifecycle,list}.ts` (`/api/admin/v1/entries`, gated by
 * `admin.collections.manage`/`admin.collections.read`) are the ONLY routes backed by THIS package's
 * `write-service.ts`/`list.ts` — exactly what this catalog wraps. Pages and Posts
 * (`server/routes/admin/pages/*`, `server/routes/admin/posts/*`) are, in this codebase's CURRENT
 * state, backed by a wholly separate legacy `features/post` module (`createPost`/`updatePost`/
 * `getAdminPostById`/`listAdminPages`, its own `post` table, routed through `core/commands`'s
 * `executeCommand` gateway, gated by `content.write`/`content.read` — a different permission
 * namespace entirely). `features/entries` has no relationship to that module at all: no shared
 * table, no shared write chokepoint, no shared permission. So this catalog's tools name their
 * resource `collections_entry_*` (pairing with `features/content-types/agent-tools.ts`'s own
 * `collections_content_type_*` prefix — the two packages are "one cohesive ADR-043 domain" per
 * `server/routes/admin/content-types/deps.ts`'s own file header), not `entry_*`/`page_*`/`post_*` —
 * a name that could be misread as covering Pages/Posts. Wiring Pages/Posts agent tools would mean
 * wrapping `features/post`, a different backend this dispatch was not asked to touch and has not
 * inspected for the same safety discipline this catalog applies here.
 *
 * Deliberate absences (the point of a catalog, not an oversight):
 * - There is no delete/purge tool: `write-service.ts` exposes no delete function at all (confirmed
 *   by reading the whole file) — there is nothing to wrap or exclude on that front.
 * - `collections_entry_update`'s schema omits `bodyJson` even though `updateEntry` itself accepts an
 *   optional `bodyJson` (REQ-44/45, used internally by `widgets/embed-service.ts`'s own guardrailed
 *   mutation path). The generic Collections admin route (`entries/update.ts`) never forwards
 *   `body.bodyJson` at all — only `title`/`fieldsJson`/`expectedVersion` — so exposing it here would
 *   invent capability beyond what the human admin UI's own Collections editor exposes. Omitting it
 *   from the input is enough: `updateEntry` leaves `bodyJson` unchanged whenever the field is
 *   `undefined`, so this exclusion changes nothing about what a call can still do.
 * - `collections_entry_list`'s schema omits `status`/`orderBy`/`limit` even though
 *   `EntryListPort.listByWorkspace` supports all three (added for `widgets/resolvers/recent-entries.ts`'s
 *   own bounded-query need) — `server/routes/admin/entries/list.ts` only ever forwards `type` from
 *   its query string, so the other three are not part of what the Collections admin list screen
 *   itself can do; adding them here would again exceed the human surface this catalog mirrors.
 *
 * What IS included, and why it is safe: all four write-service functions are `admin.collections.*`
 * self-enforcing (each opens with its own `deps.authorize()` call before any other side effect —
 * confirmed by reading `write-service.ts` directly), and `publishEntry`/`unpublishEntry` are ordinary,
 * fully reversible status flips with a full revision trail (`entryRepo.appendRevision`) — publishing
 * and unpublishing are each other's own undo.
 *
 * How it relates to the project:
 * `features/entries/tool-registrations.ts` maps these entries into `@jini-ai/core` `ToolRegistration`s.
 *
 * Architectural role:
 * `features/entries` domain declaration. No dependencies.
 */

export type AgentToolSideEffect = "none" | "mutates-durable-state" | "mints-token";

export interface AgentToolDefinition {
  name: string;
  description: string;
  sideEffects: AgentToolSideEffect;
  authorization: { permission: string };
  /**
   * JSON Schema for this tool's `input`, published to the model via `ToolDescriptor.inputSchema`
   * (`assistant/tool-registration-kit.ts`'s `buildDomainRegistrations`, which refuses to wire any
   * tool lacking one).
   */
  inputSchema?: Readonly<Record<string, unknown>>;
}

const ENTRY_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  description: "The entry's id, as returned by collections_entry_create or collections_entry_list.",
} as const;

const EXPECTED_VERSION_SCHEMA = {
  type: "integer",
  description:
    "The entry's current 'version', for optimistic concurrency. Read it first (collections_entry_list, or the previous write's own response) — a stale value is rejected with a version conflict naming the current version.",
} as const;

const FIELDS_JSON_SCHEMA = {
  type: "object",
  description:
    "The entry's field-extension bag, wrapped as { ext: { site: {...} } } (ADR-022 §2 envelope). Must conform to the owning content type's CURRENT field schema — an unrecognized key, a wrong-kind value, or a missing required field is rejected with every failing field named, before anything is written.",
} as const;

/** The Entries domain's fixed agent-tool catalog: the Collections authoring surface's 4 writes
 * (create/update/publish/unpublish) plus its 1 read (list) — see this file's header for the
 * Pages/Posts naming disclosure and the 3 deliberate scope exclusions. */
export const entriesAgentToolCatalog: AgentToolDefinition[] = [
  {
    name: "collections_entry_list",
    description:
      "Lists Collection entries in the workspace (id, type, slug, status, title, fieldsJson, bodyJson, publishedAt, timestamps, version). " +
      "Optionally narrowed to one content type. Mirrors the admin Collections list screen exactly — no status/date/limit filter is available " +
      "here because the admin route itself does not expose one.",
    sideEffects: "none",
    authorization: { permission: "admin.collections.read" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        type: { type: "string", description: "Narrow the list to one content type's entries (its 'key'). Omit to list every type." },
      },
    },
  },
  {
    name: "collections_entry_create",
    description:
      "Creates a new draft Collection entry under an existing, ACTIVE content type. Rejected if the content type does not exist in this " +
      "workspace, is deprecated/tombstoned, if fieldsJson fails the type's current field schema, or if (type, slug) is already taken. " +
      "The new entry always starts in 'draft' status — use collections_entry_publish afterward to publish it.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.collections.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["type", "slug", "title"],
      properties: {
        type: { type: "string", minLength: 1, description: "The owning content type's key. Must be an ACTIVE content type already registered in this workspace." },
        slug: { type: "string", minLength: 1, description: "URL-safe slug, unique per (type). A second entry with the same (type, slug) is rejected as a conflict." },
        title: { type: "string", minLength: 1, description: "Human-readable title." },
        fieldsJson: { ...FIELDS_JSON_SCHEMA, description: `${FIELDS_JSON_SCHEMA.description} Omit for an empty { ext: { site: {} } } envelope.` },
        bodyJson: { description: "Optional rich-text body document (TipTap JSON). Not schema-validated." },
      },
    },
  },
  {
    name: "collections_entry_update",
    description:
      "Updates an existing entry's title and/or fieldsJson (only the fields supplied change). Rejected if the entry does not exist, if its " +
      "owning content type is tombstoned (a deprecated owning type does NOT block this), if fieldsJson fails the type's current schema, or if " +
      "expectedVersion is stale. Cannot change an entry's bodyJson through this tool — the Collections admin editor itself does not expose that.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.collections.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "expectedVersion"],
      properties: {
        id: ENTRY_ID_SCHEMA,
        expectedVersion: EXPECTED_VERSION_SCHEMA,
        title: { type: "string", minLength: 1, description: "New title. Omit to leave the current title unchanged." },
        fieldsJson: { ...FIELDS_JSON_SCHEMA, description: `COMPLETE replacement field-extension bag. ${FIELDS_JSON_SCHEMA.description} Omit to leave fields unchanged.` },
      },
    },
  },
  {
    name: "collections_entry_publish",
    description:
      "Flips an entry to 'published' (sets publishedAt to now). Rejected only if the owning content type is tombstoned, or if " +
      "expectedVersion is stale. A deprecated owning type does not block this. Fully reversible via collections_entry_unpublish.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.collections.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "expectedVersion"],
      properties: { id: ENTRY_ID_SCHEMA, expectedVersion: EXPECTED_VERSION_SCHEMA },
    },
  },
  {
    name: "collections_entry_unpublish",
    description:
      "Flips an entry to 'unpublished' (publishedAt is left as-is; only the status changes). Rejected only if the owning content type is " +
      "tombstoned, or if expectedVersion is stale. A deprecated owning type does not block this. Fully reversible via collections_entry_publish.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.collections.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "expectedVersion"],
      properties: { id: ENTRY_ID_SCHEMA, expectedVersion: EXPECTED_VERSION_SCHEMA },
    },
  },
];
