/**
 * @file REQ-22/REQ-23 — the Collections content-types agent-tool catalog, instantiating
 * a REQ-22 naming/callability convention (mirrors `features/database/agent-tools.ts`'s
 * shape for this domain).
 *
 * Purpose:
 * A static, in-process catalog describing every agent-callable tool this domain exposes and the
 * permission/actor-class rule each one carries. `collections_content_type_list` (admin-UI-backend-
 * gap closure, mirroring `routes/admin/content-types/list.ts`) and `collections_plan_cleanup` are
 * both free reads (`admin.collections.read`, `sideEffects:'none'`) — the former lists the registry,
 * the latter only recomputes and returns an eligibility plan. `collections_execute_cleanup` is the
 * one destructive tool, gated to
 * `admin.collections.manage` and restricted to `confirmer-must-equal-own-delegatedBy`. There is
 * deliberately no `collections_confirm_cleanup` tool and no tool description implying an agent can
 * perform the confirm() step — confirmation of a destructive cleanup is human-UI-only (mirrors
 * the Database library's "Restore is a Recovery tool, not a Database tool" discipline: a lever an agent must
 * never be handed directly).
 *
 * How it relates to the project:
 * The server-side tool filter consumes this catalog to decide which tool names an agent
 * session may even see; `authorize()` and the confirmation-token gateway (`core/gated-mutations`)
 * enforce the actual permission/actor-class checks at call time — this module only declares the
 * catalog shape, it performs no I/O and no enforcement itself.
 *
 * Architectural role:
 * `features/content-types` domain logic. Performs no I/O and no enforcement. Depends only on this
 * package's own `types.ts` (the field-kind enum) and `index-provisioning.ts` (the identifier
 * grammar pattern) — imported so the published JSON Schemas cannot drift from the single sources
 * of those two values, rather than restating either.
 */

import { IDENTIFIER_GRAMMAR_PATTERN } from "./index-provisioning.js";
import { CONTENT_TYPE_FIELD_KINDS } from "./types.js";

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
   * (`assistant/tool-registrations.ts`). Optional because the two cleanup entries are not wired to
   * handlers yet and their input shape is not designed; `tool-registrations.ts` asserts that every
   * tool it DOES wire has one.
   *
   * These schemas are hand-authored, and enforcement lives elsewhere — `field-defs.ts` for
   * structure and `write-service.ts`'s CIC U-002-B1 chain for the domain rules. That is a
   * deliberate two-artifact design, so the pair is pinned against drift by a fixture corpus in
   * `__tests__/unit/agent-tools.schema-agreement.unit.test.ts`. The two values a schema would
   * otherwise duplicate — the field-kind enum and the identifier grammar — are imported from their
   * single sources rather than restated.
   */
  inputSchema?: Readonly<Record<string, unknown>>;
}

/** One entry of a `fields` array, as published to the model. Mirrors what `field-defs.ts` enforces. */
const FIELD_DEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "kind", "required", "queryable"],
  properties: {
    name: {
      type: "string",
      pattern: IDENTIFIER_GRAMMAR_PATTERN,
      description: "Field name. Lowercase letters, digits and underscores; must start with a letter; max 64 characters.",
    },
    kind: {
      type: "string",
      enum: [...CONTENT_TYPE_FIELD_KINDS],
      description: "One of the five supported storage kinds. No other value is accepted.",
    },
    required: { type: "boolean", description: "Whether an entry must supply this field. Must be a real boolean, not a string." },
    queryable: {
      type: "boolean",
      description: "Whether this field gets a queryable index. Must be a real boolean, not a string. At most 20 queryable fields per content type.",
    },
  },
} as const;

/** The input shape of the one read tool this catalog carries — it takes no arguments. */
const NO_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [],
  properties: {},
} as const;

/** The `fields` property shared by `define` and `update_fields`. */
const FIELDS_SCHEMA = {
  type: "array",
  maxItems: 500,
  items: FIELD_DEF_SCHEMA,
  description: "The COMPLETE field list. Both tools that accept it replace the whole schema — omitted fields are dropped, not preserved.",
} as const;

/** `expectedVersion` — present on every tool that mutates an existing content type (OCC). */
const EXPECTED_VERSION_SCHEMA = {
  type: "integer",
  description: "The content type's current `version`, for optimistic concurrency. Read it first; a stale value is rejected with VersionConflictError rather than overwriting.",
} as const;

/** The input schema shared by the three lifecycle transitions, which take exactly `{key, expectedVersion}`. */
const LIFECYCLE_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["key", "expectedVersion"],
  properties: {
    key: { type: "string", pattern: IDENTIFIER_GRAMMAR_PATTERN, description: "The content type's key." },
    expectedVersion: EXPECTED_VERSION_SCHEMA,
  },
} as const;

/**
 * REQ-22/REQ-23 — the Collections content-types domain's fixed agent-tool catalog.
 *
 * `collections_content_type_list` is ordered first, mirroring `identity/agent-tools.ts`'s
 * "read-tools-first" convention: a model cannot call `update_fields`/`deprecate`/`reactivate`/
 * `tombstone` without a `key` and current `expectedVersion`, and this is the only way to learn
 * either for a content type it did not itself just create.
 */
export const contentTypesAgentToolCatalog: AgentToolDefinition[] = [
  {
    name: "collections_content_type_list",
    description:
      "Lists every content type registered in the workspace — active, deprecated, and tombstoned alike — with its key, label, status, version, and fields. Read-only. Call this before update_fields/deprecate/reactivate/tombstone to find a content type's key and current version.",
    sideEffects: "none",
    authorization: { permission: "admin.collections.read" },
    inputSchema: NO_INPUT_SCHEMA,
  },
  {
    name: "collections_plan_cleanup",
    description: "Recomputes and returns the destructive-removal eligibility plan for a tombstoned content type. Read-only; performs no removal.",
    sideEffects: "none",
    authorization: { permission: "admin.collections.read" },
  },
  {
    name: "collections_execute_cleanup",
    description: "Executes the destructive, atomic removal of a tombstoned content type and all of its scoped rows, using a previously redeemed token.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.collections.manage" },
    actorClassRule: "confirmer-must-equal-own-delegatedBy",
  },
  {
    name: "collections_content_type_define",
    description: "Registers a new operator-defined content type in the registry.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.collections.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["key", "label", "fields"],
      properties: {
        key: {
          type: "string",
          pattern: IDENTIFIER_GRAMMAR_PATTERN,
          description: "Permanent identifier for the content type. Cannot be changed later. 'post' and 'page' are permanently reserved and will be rejected.",
        },
        label: { type: "string", description: "Human-readable display name shown in the admin UI." },
        fields: FIELDS_SCHEMA,
      },
    },
  },
  {
    name: "collections_content_type_update_fields",
    description: "Full-replaces a content type's field schema.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.collections.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["key", "fields", "expectedVersion"],
      properties: {
        key: { type: "string", pattern: IDENTIFIER_GRAMMAR_PATTERN, description: "The content type's key." },
        fields: FIELDS_SCHEMA,
        expectedVersion: EXPECTED_VERSION_SCHEMA,
      },
    },
  },
  {
    name: "collections_content_type_deprecate",
    description: "Deprecates an active content type, blocking new entry creation only.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.collections.manage" },
    inputSchema: LIFECYCLE_INPUT_SCHEMA,
  },
  {
    name: "collections_content_type_reactivate",
    description: "Reactivates a deprecated content type back to active.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.collections.manage" },
    inputSchema: LIFECYCLE_INPUT_SCHEMA,
  },
  {
    name: "collections_content_type_tombstone",
    description: "Tombstones a deprecated content type and tears down its provisioned queryable-field indexes.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.collections.manage" },
    inputSchema: LIFECYCLE_INPUT_SCHEMA,
  },
];
