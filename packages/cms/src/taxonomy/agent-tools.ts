/**
 * @file The Taxonomy agent-tool catalog (SPEC-018/ADR-044) — this domain's instance of the
 * per-domain `agent-tools.ts` convention `features/content-types/agent-tools.ts`,
 * `features/database/agent-tools.ts`, and every other domain catalog already use (ADR-049
 * Decision 4).
 *
 * Purpose:
 * A static, in-process catalog describing every agent-callable tool this domain exposes. Every
 * WRITE entry maps 1:1 onto a real exported function of `features/taxonomy/write-service.ts`
 * (`createTaxonomy`, `createTerm`, `renameTerm`, `assignTerms`); the one read maps onto
 * `features/taxonomy/list.ts`'s `listTaxonomiesWithTerms`.
 *
 * `mergeTerm` (SPEC-018 C-207, `merge-term.ts`) — read carefully, treated with the same scrutiny
 * Database's `migrate-forward` and Recovery's `restore` ceremonies got:
 * Merge is destructive and can silently lose pre-merge `entry_terms` assignment history for content
 * already assigned to both terms (`merge-term.ts`'s own file header: "ADR-044's 'Destructive term
 * merge' failure mode"). That is why it alone, of every taxonomy mutation, gets a plan/confirm/
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
 *     exists in this catalog, and no description below may even imply that step (mirrors
 *     `features/recovery/agent-tools.ts`'s own INV-06 discipline for `backup_execute_restore`: "the
 *     human confirmation step is exactly the one act SPEC-016's gateway reserves for kind='user'/
 *     api_key principals").
 *   - `execute()` needs a confirmation token a human already minted through the admin UI's own
 *     ceremony (`server/routes/admin/taxonomy/merge-term.ts`'s `/merge/confirm` route) — the same
 *     `confirmer-must-equal-own-delegatedBy` actor-class rule `database_execute_migrate_forward`/
 *     `backup_execute_restore` carry, which `assistant/tool-registration-kit.ts`'s
 *     `ACTOR_CLASS_RULES_REQUIRING_CONFIRMATION_TRANSPORT` refuses to build regardless of this
 *     catalog's own choice, because the host's `ToolExecutor` has no confirmation transport wired.
 *     `taxonomy_execute_merge_term` is declared here (so the exclusion is a structural build-time
 *     refusal, not just an absent handler) but is NEVER wired by `tool-registrations.ts`.
 *
 * Naming: `taxonomy_*`, matching this package's own name — distinct from `features/content-types`'
 * `collections_*` prefix (a different ADR-043 pairing) and from `features/entries`' own
 * `collections_entry_*` prefix.
 *
 * How it relates to the project:
 * `features/taxonomy/tool-registrations.ts` maps these entries into `@jini-ai/core`
 * `ToolRegistration`s.
 *
 * Architectural role:
 * `features/taxonomy` domain declaration. Imports only `TAXONOMY_ALLOWED_CONTENT_TYPES` from its
 * own `write-service.ts`, so the published `contentType` enum cannot drift from what the domain
 * actually accepts.
 */

import { TAXONOMY_ALLOWED_CONTENT_TYPES } from "./write-service.js";

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
   * tool lacking one). Optional — `taxonomy_execute_merge_term` is never wired, so it carries none.
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

const CONTENT_TYPE_SCHEMA = {
  type: "string",
  enum: [...TAXONOMY_ALLOWED_CONTENT_TYPES],
  description: "The content kind the target row actually is. Only 'post' and 'page' are eligible for term assignment (ADR-044's permanent allow-list) — any other value is rejected before anything is written.",
} as const;

/** The Taxonomy domain's fixed agent-tool catalog: 6 wired (1 read, 4 ordinary writes, 1 gated-plan
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
      "Tags screen both use). Additive only — this call ADDS assignments; it never removes a term not present in termIds, and calling it twice " +
      "with the same term is a no-op (idempotent). Every termId is validated (must exist; its taxonomy must be applicable to contentType) " +
      "before ANY row is written, so a bad id in the list rejects the whole call rather than partially assigning.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.taxonomy.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["contentType", "contentId", "termIds"],
      properties: {
        contentType: CONTENT_TYPE_SCHEMA,
        contentId: { type: "string", minLength: 1, description: "The id of the post/page row to assign terms to." },
        termIds: { type: "array", items: { type: "string" }, description: "Term ids to assign. May be empty (a no-op)." },
      },
    },
  },
  {
    name: "taxonomy_plan_merge_term",
    description:
      "Previews merging one term into another: recomputes and returns the current overlap-loss disclosure (how many pieces of content are " +
      "already assigned to BOTH terms, whose duplicate assignment would be silently lost by the merge's own dedup step) plus a planId/planHash " +
      "a human can use in the admin UI's own merge confirmation ceremony. Read-only — performs no merge. Rejects immediately if fromTermId " +
      "equals intoTermId, before computing anything. This tool can only PLAN a merge; actually executing one requires a human to confirm " +
      "through the admin UI — no tool in this catalog can do that step (by design: merges are destructive and irreversible for the merged-away " +
      "term's own identity).",
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
    // EXCLUDED BY DESIGN, never wired: see this file's header. Token-gated; `core/gated-mutations`'s
    // own confirm() step structurally refuses an agent principal, and no confirmation transport
    // exists for an agent to be handed a human-minted token through anyway.
    name: "taxonomy_execute_merge_term",
    description: "Executes a previously confirmed term merge using a human-minted confirmation token. NEVER agent-callable — see file header.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.taxonomy.manage" },
    actorClassRule: "confirmer-must-equal-own-delegatedBy",
  },
];
