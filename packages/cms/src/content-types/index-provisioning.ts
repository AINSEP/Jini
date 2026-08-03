import { createHash } from "node:crypto";

import { InvalidFieldKindError, InvalidFieldNameGrammarError, InvalidKeyGrammarError } from "./errors.js";
import { CONTENT_TYPE_FIELD_KINDS, type ContentTypeFieldKind, isContentTypeFieldKind } from "./types.js";

/**
 * @file CIC U-001 (SPEC-020) — the `kind`->`CAST` fixed lookup table, the identifier grammar
 * gate, the workspace-scoped queryable-index naming scheme, and the before/after index-transition
 * resolver (ADR-022 §3, ADR-043 §4's round-3/round-5 grammar-and-workspace-scoping folds).
 *
 * Purpose:
 * THIS IS THE HIGHEST-SECURITY-SEVERITY MODULE IN THE 5-PACKAGE PIPELINE — every value that ends
 * up inside a `CREATE INDEX ... CAST(json_extract(fields,'$.ext.{ns}.{field}') AS {type})`
 * statement (ADR-022 §3) is produced here, and only here:
 *   - `mapFieldKindToCast` never interpolates an operator-supplied string — it is a fixed,
 *     hardcoded 5-entry table (U-001-B1).
 *   - `validateIdentifierGrammar`/`buildQueryableFieldIndexName` gate every `key`/field name
 *     through `^[a-z][a-z0-9_]{0,63}$` before it can reach an index-name segment or JSON-path
 *     literal (U-001-B2), and join grammar-gated segments with `/` — a delimiter outside the
 *     grammar's own alphabet `[a-z0-9_]`, closing the namespace-injectivity collision class
 *     (U-001-B3) — and fold in a workspace-derived segment so two workspaces defining the same
 *     `(key, field)` pair never collide on index identity (ADR-043 §4 round-5 fold).
 *
 * How it relates to the project:
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
 * same grammar instead of restating it. GOV-ADR-003 makes this grammar load-bearing for DDL
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
 */
const KIND_TO_CAST_LITERAL: Record<ContentTypeFieldKind, string> = {
  text: "TEXT",
  integer: "INTEGER",
  real: "REAL",
  boolean: "BOOLEAN",
  datetime: "TEXT",
};

/**
 * Maps a closed-enum field `kind` to its fixed `CAST(... AS {type})` type token. Throws
 * {@link InvalidFieldKindError} for anything not exactly one of the 5 enum values — this is a
 * lookup, never a template, so an adversarial payload can never reach the returned string
 * (U-001-B1).
 *
 * @complexity O(1) — a fixed-size object lookup.
 * @overallScore 100
 */
export function mapFieldKindToCast(kind: ContentTypeFieldKind): string {
  if (!isContentTypeFieldKind(kind)) {
    throw new InvalidFieldKindError(
      `'${String(kind)}' is not one of the closed field-kind enum (${CONTENT_TYPE_FIELD_KINDS.join("|")}) — U-001-B1`
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
  /** Present only for `provision`/`reprovision` — always the field's POST-call kind. */
  newKind?: ContentTypeFieldKind;
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
  if (!beforeQueryable && afterQueryable) return { action: "provision", newKind: params.after!.kind };
  if (params.before!.kind !== params.after!.kind) {
    return { action: "reprovision", newKind: params.after!.kind };
  }
  return { action: "none" };
}
