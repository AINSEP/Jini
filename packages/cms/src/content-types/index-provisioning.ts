import { createHash } from "node:crypto";

import { InvalidFieldKindError, InvalidFieldNameGrammarError, InvalidKeyGrammarError } from "./errors.js";
import {
  INDEXABLE_FIELD_KINDS,
  type ContentTypeFieldKind,
  type IndexableFieldKind,
  isIndexableFieldKind,
} from "./types.js";

/**
 * @file CIC U-001 — the `kind`->`CAST` fixed lookup table, the identifier grammar
 * gate, the workspace-scoped queryable-index naming scheme, and the before/after index-transition
 * resolver (grammar-and-workspace-scoping folds).
 *
 * Purpose:
 * THIS IS THE HIGHEST-SECURITY-SEVERITY MODULE IN THE 5-PACKAGE PIPELINE — every value that ends
 * up inside a `CREATE INDEX ... CAST(json_extract(fields,'$.ext.{ns}.{field}') AS {type})`
 * statement is produced here, and only here:
 *   - `mapFieldKindToCast` (U-001-B1). STATE THE INVARIANT PRECISELY, because an earlier version
 *     of this comment did not and the imprecision was itself a hazard: it said "a fixed, hardcoded
 *     5-entry table", which reads as though the ENTRY COUNT were the defense. It is not. Neither
 *     the number of keys nor the number of distinct values is the security boundary.
 *
 *     THE DEFENSE IS: this function returns a VALUE FROM THE TABLE and never returns, echoes, or
 *     interpolates its own ARGUMENT. The function has exactly one `return`, and it is a table
 *     lookup. Therefore the set of strings that can reach a `CAST(... AS {type})` position is
 *     exactly the set of string literals written into `KIND_TO_CAST_LITERAL` in this source file —
 *     compile-time constants, every one — no matter what an operator, an agent, or an attacker
 *     supplies as `kind`. A 50-entry table of literals would be exactly as safe as a 5-entry one.
 *
 *     What follows from that, and what a maintainer actually needs to know:
 *       * Adding a KEY whose value is an existing literal cannot widen the DDL alphabet. It is not
 *         a security event and does not need to be feared as one. (`relation: "TEXT"` is exactly
 *         this: `"TEXT"` was already present twice.)
 *       * Adding a new VALUE does widen it, and must be reviewed as a DDL change.
 *       * Returning, concatenating, or template-interpolating `kind` itself — or reading the table
 *         with a fallback such as `?? kind` — BREAKS the invariant outright. That is the edit to
 *         refuse, and it is the one the old "5-entry" phrasing gave no way to recognise.
 *     The reachable-value set is pinned executably by `HISTORICAL_DDL_ALPHABET` in
 *     `__tests__/field-kind-widening.test.ts`, so this claim is a failing test and not only prose.
 *
 *     Degraded failure mode, stated so the blast radius is known: if every runtime guard below
 *     were deleted, a storage-only kind would reach the table and `KIND_TO_CAST_LITERAL["json"]`
 *     would evaluate to `undefined` — a SQL syntax error and a loud broken feature, never an
 *     operator-controlled string. Total guard removal degrades this module to unavailable, not to
 *     injectable. That is the property worth preserving through any future change.
 *   - `validateIdentifierGrammar`/`buildQueryableFieldIndexName` gate every `key`/field name
 *     through `^[a-z][a-z0-9_]{0,63}$` before it can reach an index-name segment or JSON-path
 *     literal (U-001-B2), and join grammar-gated segments with `/` — a delimiter outside the
 *     grammar's own alphabet `[a-z0-9_]`, closing the namespace-injectivity collision class
 *     (U-001-B3) — and fold in a workspace-derived segment so two workspaces defining the same
 *     `(key, field)` pair never collide on index identity.
 *
 * How it relates to the project:
 * `resolveFieldIndexTransition` deliberately still ACCEPTS a storage-only kind on its `none` and
 * `teardown` arms while rejecting it on the two provisioning arms. Teardown must stay reachable:
 * an index left behind by a bypassed or since-added guard has to remain droppable, and a resolver
 * that refused to look at the kind at all could never order that cleanup.
 *
 * `write-service.ts`'s `registerContentType`/`updateContentTypeFields` call
 * `resolveFieldIndexTransition` once per field (never two independent kind/queryable branches —
 * CIC U-003-B1) and hand the result to the injected `indexProvisioner` port, which is the only
 * thing that ever issues the real `CREATE INDEX`/`DROP INDEX` DDL (this module only decides what
 * to build, never executes DDL itself).
 *
 * Architectural role:
 * `features/content-types` domain logic. No dependencies beyond `node:crypto` (workspace-segment
 * hashing) and this package's own `errors.ts`/`types.ts`.
 */

/**
 * U-001-B2 — the closed identifier grammar every `content_types.key` and field name must satisfy,
 * as a pattern string so the agent-facing JSON Schemas in `agent-tools.ts` can publish the very
 * same grammar instead of restating it. A cross-cutting single-source-of-truth governance rule makes this grammar load-bearing for DDL
 * safety, so it must have exactly one definition; {@link IDENTIFIER_GRAMMAR} is compiled from this
 * string rather than written twice.
 */
export const IDENTIFIER_GRAMMAR_PATTERN = "^[a-z][a-z0-9_]{0,63}$";

/** U-001-B2 — the closed identifier grammar every `content_types.key` and field name must satisfy. */
const IDENTIFIER_GRAMMAR = new RegExp(IDENTIFIER_GRAMMAR_PATTERN);

/**
 * Structural grammar gate for a `content_types.key` or field name (U-001-B2).
 *
 * @complexity O(n) in the string's length (regex match), bounded at 64 chars.
 * @overallScore 100
 */
export function validateIdentifierGrammar(value: string): boolean {
  return IDENTIFIER_GRAMMAR.test(value);
}

/**
 * U-001-B1 — the fixed, hardcoded `kind` -> SQL `CAST` type-token table. Every value here is a
 * plain uppercase SQL type token with no quotes/parens/whitespace; never built by concatenation.
 *
 * Keyed by `IndexableFieldKind`, NOT `ContentTypeFieldKind`: a storage-only kind has no CAST
 * target, and typing the table over the wider union would force one to be invented — which is the
 * actual hazard this split exists to prevent. The `Record` is what makes exhaustiveness
 * compiler-enforced: adding a member to `INDEXABLE_FIELD_KINDS` fails the build until an entry
 * appears here. Do not replace it with a `Partial`, an index signature, or a lookup with a
 * fallback — each of those converts a build failure into a runtime surprise on the DDL path.
 */
const KIND_TO_CAST_LITERAL: Record<IndexableFieldKind, string> = {
  text: "TEXT",
  integer: "INTEGER",
  real: "REAL",
  boolean: "BOOLEAN",
  datetime: "TEXT",
  /**
   * A foreign entity id, stored with `text`'s storage class. This adds a KEY to the table and no
   * new VALUE to the DDL alphabet — `"TEXT"` already appears twice above — so the set of strings
   * reachable from a `CAST(... AS {type})` position is unchanged by its presence.
   */
  relation: "TEXT",
};

/**
 * Maps an INDEXABLE field `kind` to its fixed `CAST(... AS {type})` type token. Throws
 * {@link InvalidFieldKindError} for anything that is not exactly one of `INDEXABLE_FIELD_KINDS` —
 * including a storage-only kind such as `json`, which is a legal kind to declare but has no CAST
 * target. This is a lookup, never a template, so an adversarial payload can never reach the
 * returned string (U-001-B1).
 *
 * The PARAMETER type is deliberately the wider `ContentTypeFieldKind`. Narrowing it would be a
 * breaking change for `@jini-ai/cms`'s public consumers (`content-types/index.ts` documents this
 * function as what a host's own DDL provisioner calls, and the host re-exports it), and it would also
 * make the runtime guard below unreachable-looking to a reader while remaining fully reachable to
 * an untyped JavaScript caller. The runtime gate — not the signature — is what excludes
 * storage-only kinds.
 *
 * Behavior for the five original scalars is unchanged in every respect: `isIndexableFieldKind` and
 * `isContentTypeFieldKind` agree on all five, and each still returns the identical literal.
 *
 * @complexity O(1) — a fixed-size object lookup behind a fixed-size membership test.
 * @overallScore 100
 */
export function mapFieldKindToCast(kind: ContentTypeFieldKind): string {
  if (!isIndexableFieldKind(kind)) {
    throw new InvalidFieldKindError(
      `'${String(kind)}' is not an indexable field kind (${INDEXABLE_FIELD_KINDS.join("|")}) — U-001-B1`
    );
  }
  return KIND_TO_CAST_LITERAL[kind];
}

/**
 * Derives a grammar-safe, workspace-scoped index-name segment from an arbitrary `workspaceId`
 * (which itself is not grammar-constrained — e.g. `"ws-1"` contains a hyphen). Hashing collapses
 * it to a fixed `[0-9a-f]` alphabet (a strict subset of the identifier grammar's `[a-z0-9_]`)
 * prefixed with a letter so the segment independently satisfies {@link validateIdentifierGrammar}.
 *
 * @complexity O(1) — a fixed-length SHA-256 digest.
 * @overallScore 100
 */
function workspaceIndexSegment(workspaceId: string): string {
  const digest = createHash("sha256").update(workspaceId).digest("hex").slice(0, 16);
  return `w${digest}`;
}

/**
 * Builds the workspace-scoped queryable-field index identity for `(workspaceId, contentTypeKey,
 * fieldName)`. Both `contentTypeKey` and `fieldName` are grammar-gated first — a failure throws
 * before any index name is produced (U-001-B2). Segments are joined with `/`, a delimiter outside
 * the grammar's own alphabet `[a-z0-9_]`, so distinct `(key, name)` pairs can never collide by
 * boundary-shifting (U-001-B3, e.g. `("a_b","c")` vs `("a","b_c")`).
 *
 * @complexity O(1) plus two grammar checks and one SHA-256 hash.
 * @overallScore 100
 */
export function buildQueryableFieldIndexName(params: {
  workspaceId: string;
  contentTypeKey: string;
  fieldName: string;
}): string {
  if (!validateIdentifierGrammar(params.contentTypeKey)) {
    throw new InvalidKeyGrammarError(
      `content-type key '${params.contentTypeKey}' fails the identifier grammar gate ^[a-z][a-z0-9_]{0,63}$ (U-001-B2)`
    );
  }
  if (!validateIdentifierGrammar(params.fieldName)) {
    throw new InvalidFieldNameGrammarError(
      `field name '${params.fieldName}' fails the identifier grammar gate ^[a-z][a-z0-9_]{0,63}$ (U-001-B2)`
    );
  }
  return `q/${workspaceIndexSegment(params.workspaceId)}/${params.contentTypeKey}/${params.fieldName}`;
}

/** A field's `(kind, queryable)` pair at one side of an update call, or `undefined` if absent (new/removed). */
export type FieldIndexState = { kind: ContentTypeFieldKind; queryable: boolean } | undefined;

export interface FieldIndexTransition {
  action: "none" | "provision" | "teardown" | "reprovision";
  /**
   * Present only for `provision`/`reprovision` — always the field's POST-call kind, and always
   * INDEXABLE. A storage-only kind cannot be `queryable` (rejected by `write-service.ts`'s guard
   * 4b, which runs before any transition is resolved), so it can never reach these two arms.
   */
  newKind?: IndexableFieldKind;
}

/**
 * Narrows a post-call field kind for the two arms that hand a kind to the index provisioner.
 *
 * Expected to be unreachable: `write-service.ts`'s guard chain rejects `queryable: true` on a
 * storage-only kind before any transition is resolved. Asserted rather than cast away so that a
 * future caller which bypasses that chain fails loudly here — at the last point before a kind
 * becomes an index — instead of silently provisioning an index for an unindexable kind.
 *
 * @complexity O(1).
 * @overallScore 100
 */
function assertIndexableForProvisioning(kind: ContentTypeFieldKind): IndexableFieldKind {
  if (!isIndexableFieldKind(kind)) {
    throw new InvalidFieldKindError(
      `storage-only kind '${String(kind)}' reached index provisioning; only (${INDEXABLE_FIELD_KINDS.join("|")}) may be queryable — U-001-B1`
    );
  }
  return kind;
}

/**
 * CIC U-003-B1 — resolves a single field's index transition from ONE before/after comparison of
 * its `(kind, queryable)` pair, never from two independent branches that each assume the other
 * property is unchanged (the bug class this closes: a field whose `kind` AND `queryable` both
 * change in the same call must still resolve correctly — REQ-30(b)).
 *
 * @complexity O(1) — four comparisons, one of four fixed outcomes.
 * @overallScore 100
 */
export function resolveFieldIndexTransition(params: {
  before: FieldIndexState;
  after: FieldIndexState;
}): FieldIndexTransition {
  const beforeQueryable = params.before?.queryable ?? false;
  const afterQueryable = params.after?.queryable ?? false;

  if (!beforeQueryable && !afterQueryable) return { action: "none" };
  if (beforeQueryable && !afterQueryable) return { action: "teardown" };
  if (!beforeQueryable && afterQueryable) {
    return { action: "provision", newKind: assertIndexableForProvisioning(params.after!.kind) };
  }
  if (params.before!.kind !== params.after!.kind) {
    return { action: "reprovision", newKind: assertIndexableForProvisioning(params.after!.kind) };
  }
  return { action: "none" };
}
