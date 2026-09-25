/**
 * @file The Taxonomy agent-tool catalog — this domain's instance of the per-domain
 * `agent-tools.ts` convention `features/content-types/agent-tools.ts`,
 * `features/database/agent-tools.ts`, and every other domain catalog already use.
 *
 * Purpose:
 * A static, in-process catalog describing every agent-callable tool this domain exposes. Every
 * WRITE entry maps 1:1 onto a real exported function of `features/taxonomy/write-service.ts`
 * (`createTaxonomy`, `createTerm`, `renameTerm`, `assignTerms`); the one read maps onto
 * `features/taxonomy/list.ts`'s `listTaxonomiesWithTerms`.
 *
 * `mergeTerm` (`merge-term.ts`) — read carefully, treated with the same scrutiny Database's
 * `migrate-forward` and Recovery's `restore` ceremonies got:
 * Merge is destructive and can silently lose pre-merge `entry_terms` assignment history for content
 * already assigned to both terms (`merge-term.ts`'s own file header: "Destructive term
 * merge" failure mode). That is why it alone, of every taxonomy mutation, gets a plan/confirm/
 * execute ceremony through `core/gated-mutations` rather than an ordinary authorize-then-write.
 * Reading `core/gated-mutations/gateway.ts` directly settles what is and is not safe to hand an
 * agent:
 *   - `plan()` "Never invokes `hooks.executeMutation()` — a plan is read-only by construction
 *     (AC-10)" (`gateway.ts`'s own doc comment). It authorizes `admin.taxonomy.manage`, recomputes
 *     the live overlap-loss disclosure, and returns a plan. Persists nothing. Safe to wire as a
 *     READ, mirroring `features/database/agent-tools.ts`'s identical `database_plan_migrate_forward`
 *     precedent (same file's own comment: "the step that actually redeems a plan into a mutation
 *     (confirm()) can never be reached by an agent principal at all").
 *   - `confirm()` structurally refuses an agent: `gateway.ts`'s own body — "if (principalKind ===
 *     'agent') throw new ForbiddenError('agent principals may not confirm a gated mutation', ...)"
 *     — before any permission check even runs. No `taxonomy_confirm_merge_term`-equivalent tool
 *     exists in this catalog.
 *   - `taxonomy_execute_merge_term` (2026-09-24) asks the human in chat before it runs: the host
 *     wires it with the kit's `humanConfirmedHandler`, which shows a confirm dialog and only on the
 *     human's own click confirms as that human (`kind='user'`) and executes as the agent acting for
 *     them — the `confirmer-must-equal-own-delegatedBy` rule. The model never sees or supplies a
 *     token. A merge deletes the source term's assignments with no Trash or undo, so it is gated.
 *
 * Naming: `taxonomy_*`, matching this package's own name — distinct from `features/content-types`'
 * `collections_*` prefix (a different pairing) and from `features/entries`' own
 * `collections_entry_*` prefix.
 *
 * How it relates to the project:
 * `features/taxonomy/tool-registrations.ts` maps these entries into `@jini-ai/core`
 * `ToolRegistration`s.
 *
 * Architectural role:
 * `features/taxonomy` domain declaration. As of A2 (taxonomy plan) it imports nothing from its own
 * `write-service.ts` — `contentType` is published as an open string (see `CONTENT_TYPE_SCHEMA`
 * below), since Collections entries widened the set of legal values past the fixed `post`/`page`
 * allow-list this file used to mirror as an `enum`.
 */

// A2 (taxonomy plan) — no longer imported: `CONTENT_TYPE_SCHEMA` used to build its `enum` from
// this set, which would reject a Collection key (any `contentType` other than `post`/`page`) at
// the agent's own input-schema validation, before the write-service's `contentTypeTaxonomyPolicy`
// ever gets a chance to decide eligibility. See `CONTENT_TYPE_SCHEMA`'s doc comment below.

export type AgentToolSideEffect = "none" | "mutates-durable-state" | "mints-token";

export type AgentToolActorClassRule = "confirmer-must-equal-own-delegatedBy" | "user-only" | "none";

export interface AgentToolDefinition {
  name: string;
  description: string;
  sideEffects: AgentToolSideEffect;
  authorization: { permission: string };
  actorClassRule?: AgentToolActorClassRule;
  /**
   * JSON Schema for this tool's `input`, published to the model via `ToolDescriptor.inputSchema`
   * (`assistant/tool-registration-kit.ts`'s `buildDomainRegistrations`, which refuses to wire any
   * tool lacking one).
   */
  inputSchema?: Readonly<Record<string, unknown>>;
}

const TAXONOMY_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  description: "A taxonomy id, as returned by taxonomy_create_taxonomy or taxonomy_list.",
} as const;

const TERM_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  description: "A term id, as returned by taxonomy_create_term or taxonomy_list.",
} as const;

/** A2 (taxonomy plan) — an open string, not an `enum` of `TAXONOMY_ALLOWED_CONTENT_TYPES`. `post`
 * and `page` are always eligible; a Collection key (e.g. `'recipes'`) is eligible when that
 * Collection's own content-type policy allows it — a call the write-service's
 * `contentTypeTaxonomyPolicy` makes, not this schema. An `enum` here would reject a valid
 * Collection key before the request ever reached that check. */
const CONTENT_TYPE_SCHEMA = {
  type: "string",
  minLength: 1,
  description: "'post', 'page', or a Collection key (entries of that Collection).",
} as const;

/** The Taxonomy domain's fixed agent-tool catalog: 7 wired (1 read, 5 ordinary writes, 1 gated-plan
 * read) + 1 declared-but-never-wired destructive tool — see this file's header for the full
 * `mergeTerm` safety analysis. */
export const taxonomyAgentToolCatalog: AgentToolDefinition[] = [
  {
    name: "taxonomy_list",
    description: "Lists every taxonomy in the workspace together with its terms — the Categories & Tags screen's own two-pane source.",
    sideEffects: "none",
    authorization: { permission: "admin.taxonomy.manage" },
    inputSchema: { type: "object", additionalProperties: false, required: [], properties: {} },
  },
  {
    name: "taxonomy_create_taxonomy",
    description:
      "Creates a new taxonomy (a 'category'-shaped hierarchical grouping, or a 'tag'-shaped flat one — same shared table, distinguished only " +
      "by the hierarchical flag).",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.taxonomy.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["name", "hierarchical"],
      properties: {
        name: { type: "string", minLength: 1, description: "Human-readable taxonomy name, e.g. 'Category' or 'Tag'." },
        hierarchical: { type: "boolean", description: "true = category-shaped (terms may nest under a parent); false = tag-shaped (flat, no parentId allowed)." },
      },
    },
  },
  {
    name: "taxonomy_create_term",
    description:
      "Creates a new term under an existing taxonomy. If parentId is supplied, the taxonomy must be hierarchical, the parent must exist and " +
      "belong to the SAME taxonomy, and assigning it must not create a cycle — a freshly-created term has no descendants yet, so a cycle can " +
      "never actually occur here, but the same validation chain runs regardless.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.taxonomy.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["taxonomyId", "name"],
      properties: {
        taxonomyId: TAXONOMY_ID_SCHEMA,
        name: { type: "string", minLength: 1, description: "The term's name." },
        parentId: { type: "string", description: "An existing term id in the SAME taxonomy to nest this term under. Omit for a top-level term (required to be omitted for a non-hierarchical taxonomy)." },
      },
    },
  },
  {
    name: "taxonomy_rename_term",
    description: "Renames an existing term in place (its id, taxonomy, parent, and status are unchanged).",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.taxonomy.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["termId", "newName"],
      properties: { termId: TERM_ID_SCHEMA, newName: { type: "string", minLength: 1, description: "The term's new name." } },
    },
  },
  {
    name: "taxonomy_assign_terms",
    description:
      "Assigns one or more existing terms to a piece of content (the same <TermPicker> operation the Collections editor and the Categories & " +
      "Tags screen both use). This call ADDS assignments; calling it twice with the same term is a no-op (idempotent). Use " +
      "taxonomy_unassign_terms to remove an assignment. Every termId is validated (must exist; its taxonomy must be applicable to contentType) " +
      "before ANY row is written, so a bad id in the list rejects the whole call rather than partially assigning.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.taxonomy.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["contentType", "contentId", "termIds"],
      properties: {
        contentType: CONTENT_TYPE_SCHEMA,
        contentId: { type: "string", minLength: 1, description: "The id of the content row to assign terms to." },
        termIds: { type: "array", items: { type: "string" }, description: "Term ids to assign. May be empty (a no-op)." },
      },
    },
  },
  {
    name: "taxonomy_unassign_terms",
    description:
      "Removes one or more previously-assigned terms from a piece of content. Idempotent — removing a term that isn't currently assigned is a " +
      "no-op, not an error. Every termId is validated the same way taxonomy_assign_terms validates them (must exist; its taxonomy must be " +
      "applicable to contentType) before anything is removed.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.taxonomy.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["contentType", "contentId", "termIds"],
      properties: {
        contentType: CONTENT_TYPE_SCHEMA,
        contentId: { type: "string", minLength: 1, description: "The id of the content row to unassign terms from." },
        termIds: { type: "array", items: { type: "string" }, description: "Term ids to unassign. May be empty (a no-op)." },
      },
    },
  },
  {
    name: "taxonomy_plan_merge_term",
    description:
      "Previews merging one term into another: recomputes and returns the current overlap-loss disclosure (how many pieces of content are " +
      "already assigned to BOTH terms, whose duplicate assignment would be silently lost by the merge's own dedup step) plus a planId/planHash " +
      "a human can use in the admin UI's own merge confirmation ceremony. Read-only — performs no merge. Rejects immediately if fromTermId " +
      "equals intoTermId, before computing anything. To actually merge, call taxonomy_execute_merge_term, which asks the user to confirm first.",
    sideEffects: "none",
    authorization: { permission: "admin.taxonomy.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fromTermId", "intoTermId"],
      properties: {
        fromTermId: { ...TERM_ID_SCHEMA, description: "The term that would be merged away (deprecated) and re-pointed from." },
        intoTermId: { ...TERM_ID_SCHEMA, description: "The term that would receive every re-pointed assignment." },
      },
    },
  },
  {
    // Asks the human first — see this file's header.
    name: "taxonomy_execute_merge_term",
    description:
      "Merges one term into another: every piece of content tagged with fromTermId is re-tagged with intoTermId, and fromTermId is " +
      "deprecated. Shows the user a confirm dialog first and only merges if they confirm. The merge can't be undone. Call " +
      "taxonomy_plan_merge_term first to see how many items are affected.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.taxonomy.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fromTermId", "intoTermId"],
      properties: {
        fromTermId: { ...TERM_ID_SCHEMA, description: "The term to merge away. It is deprecated after the merge." },
        intoTermId: { ...TERM_ID_SCHEMA, description: "The term that receives every assignment." },
      },
    },
    actorClassRule: "confirmer-must-equal-own-delegatedBy",
  },
];
