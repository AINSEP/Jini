import { createHash } from "node:crypto";

/**
 * @file Task 1 of the publish-content (Publish Content) feature —
 * `ADS-memory/reports/2026-09-18-publish-feature-implementation-plan.md` §4, task 1.
 *
 * This is the property the whole feature's safety case rests on (plan §5, risks #1–#3, #10):
 * `version` and `updatedAt` cannot answer "is this row unchanged since we last synced?" across two
 * independently-running databases — identical content on two instances has different `version`
 * counters and different real-world save timestamps, and a naive comparison would report every
 * unchanged row as a conflict (or, worse, every genuinely-edited row as unchanged, if a caller
 * compared the wrong thing). `contentHash()` is a pure function of the entity's OWN content — never
 * its identity or its write-bookkeeping — so two databases holding the same logical content always
 * agree, and any real edit always disagrees.
 *
 * `CONTENT_HASH_VERSION` travels alongside every hash this module produces (in a bundle, in a
 * baseline row — see `type-registry.ts`'s `PackedEntity.hashVersion`) rather than being folded into
 * the hash bytes themselves, so two instances on different versions can detect the mismatch
 * (plan §5 risk #10: "refuse the run", not "silently produce an all-conflicts report") instead of
 * the version simply being unrecoverable from an opaque hex string. Bump this constant — deliberately,
 * never as a side effect of an unrelated change — any time `canonicalize`'s output for the same
 * logical input would change. The pinned snapshot test in this module's own test file exists
 * specifically to force that decision to be conscious.
 */

/** Current content-hash algorithm generation. See this file's own header for what "changed" means
 *  and why a version bump must be deliberate. */
export const CONTENT_HASH_VERSION = 1;

/**
 * Fields that describe WHO a row is or WHEN/HOW OFTEN it has been written, never WHAT it says.
 * Excluded so that the same logical content produces the same hash regardless of which database
 * it lives on, how many times it has been saved, or whether a standing-draft autosave happens to
 * be parked alongside it.
 *
 * - `id` / `workspaceId`: identity, not content. A pull that preserves the source id (plan §1.3)
 *   still must not let the id's own bytes perturb the content comparison.
 * - `version`: a per-database write counter, not a content property — see this file's header.
 * - `updatedAt`: a per-write wall-clock stamp; two saves of byte-identical content produce two
 *   different timestamps, which must never register as a content change.
 * - `autosaveJson`: a standing, not-yet-saved draft that sits beside a row without describing its
 *   real (last-saved) state. Named explicitly, even though {@link PostRecord} carries no such field
 *   itself (autosave lives in a separate `readAutosave`/`writeAutosave` seam) — a future entity
 *   `canonicalize` is asked to hash may realistically pass this key straight out of a raw row shape.
 * - `createdByKind` (2026-11-24, H4): the same per-instance provenance class as `createdByPrincipalId`
 *   (who made the row, agent or person) — never content, so it must not register as an edit.
 * - `createdByPrincipalId` / `createdAt` (Task 15, 2026-09-18, plan §4 task 15): per-instance
 *   authorship PROVENANCE, not content — the same class of fact `id`/`workspaceId` already are.
 *   Excluding them is what lets the importer copy the source's own values onto a `created` row
 *   verbatim (plan's own requirement: "do not let an importer re-stamp every post with the importing
 *   operator's id") without that copy ever being mistaken for a content edit by two instances whose
 *   own local values for these fields legitimately differ (e.g. before vs. after this feature existed
 *   pre-migration `null`s, or simply two independently-running databases disagreeing on wall-clock
 *   `createdAt`). Without this exclusion, hashing two otherwise-identical posts that merely disagree
 *   on who created them (or when) would report `conflict`/`unchanged` incorrectly.
 */
const EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  "id",
  "workspaceId",
  "version",
  "updatedAt",
  "autosaveJson",
  "createdByPrincipalId",
  "createdByKind",
  "createdAt",
]);

/** The subset of JSON values {@link normalize} ever produces — deliberately narrower than
 *  `JsonValue` elsewhere in this codebase's own JSON types, since this module's only job is to
 *  produce canonical JSON text, not to model any entity's real shape. */
type CanonicalJsonValue = null | boolean | number | string | CanonicalJsonValue[] | { [key: string]: CanonicalJsonValue };

/**
 * Recursively rewrites `value` into a canonical form: object keys sorted lexicographically at
 * every level, and every `undefined` — an object property whose value is `undefined`, or an array
 * hole/element — replaced by an explicit `null`.
 *
 * Both rewrites exist for the same reason: `JSON.stringify` alone gives two different readers of
 * "the same" logical object two different byte strings whenever (a) the object's own key insertion
 * order differs (a JS engine/adapter detail, not a content fact — e.g. a SQLite adapter's `toRecord`
 * building a `PostRecord` literal in one field order vs. an in-memory adapter's own literal), or
 * (b) one reader represents "this optional field was never set" as a missing key and another
 * represents it as `{field: undefined}` — `JSON.stringify` silently DROPS an object property whose
 * value is `undefined`, so those two shapes would otherwise canonicalize identically to "key absent"
 * only by accident, and inconsistently once a caller's undefined happens to sit inside an array
 * (where `JSON.stringify` instead emits `null`, not drop-the-element). Converting every `undefined`
 * to an explicit `null` up front makes the "field never set" contract uniform and documented instead
 * of borrowed accidentally from `JSON.stringify`'s own array/object inconsistency.
 *
 * @complexity O(n) in the total number of properties/elements across the whole value tree — one
 * visit per node, one sort per object level (bounded by that level's own key count, never the
 * whole tree).
 */
function normalize({ value }: { value: unknown }, _optional = {}): CanonicalJsonValue {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map((item) => normalize({ value: item }));
  if (typeof value === "object") {
    const sorted: Record<string, CanonicalJsonValue> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = normalize({ value: (value as Record<string, unknown>)[key] });
    }
    return sorted;
  }
  // string | number | boolean — already a valid canonical JSON scalar.
  return value as CanonicalJsonValue;
}

/** Returns a shallow copy of `state` with every key in {@link EXCLUDED_KEYS} removed. */
function omitExcludedKeys(state: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (EXCLUDED_KEYS.has(key)) continue;
    filtered[key] = value;
  }
  return filtered;
}

/**
 * Produces the canonical JSON text `contentHash` hashes — exported in its own right so a caller (or
 * a test) can inspect/pin the exact bytes without re-deriving them from a digest.
 *
 * `entityType` is folded into the canonical text (not just used to pick a canonicalization branch),
 * so two entities of different types that happen to hold structurally identical `state` objects
 * still hash differently — the discriminator is part of what is being identified, exactly as
 * `PackedEntity.entityType` travels alongside `contentHash` everywhere else in the feature.
 *
 * @param required.entityType Stable wire discriminator (e.g. `"post"`, `"page"`) — see
 * `type-registry.ts`'s `PublishContentHandler.entityType` doc for the "never renamed" contract.
 * @param required.state The entity's own field bag, in whatever shape its owning domain type uses. Identity
 * and write-bookkeeping fields ({@link EXCLUDED_KEYS}) may be present — they are dropped here, so a
 * caller can pass a whole domain record (e.g. a `PostRecord`) without pre-filtering it.
 * @returns Deterministic JSON text: `{"entityType":...,"state":{...sorted keys...}}`, no
 * insignificant whitespace, no dropped-vs-null ambiguity for `undefined` fields.
 * @complexity See {@link normalize}.
 */
export function canonicalize({ entityType, state }: { entityType: string; state: Record<string, unknown> }, _optional = {}): string {
  const canonicalState = normalize({ value: omitExcludedKeys(state) });
  return JSON.stringify({ entityType, state: canonicalState });
}

/**
 * Hashes one entity's content — the property "unchanged since we last synced" is built on (this
 * file's own header). Pure and deterministic: the same `(entityType, state)` always produces the
 * same digest, on any machine, in any process.
 *
 * Does NOT embed {@link CONTENT_HASH_VERSION} in its output — the version travels as a sibling
 * value everywhere a hash is stored or transmitted (see this file's header for why).
 *
 * @returns A lowercase hex-encoded SHA-256 digest of {@link canonicalize}'s output.
 * @complexity O(n) in `state`'s total size (one canonicalization pass, one hash pass over the
 * resulting text).
 */
export function contentHash({ entityType, state }: { entityType: string; state: Record<string, unknown> }, _optional = {}): string {
  return createHash("sha256").update(canonicalize({ entityType, state }), "utf8").digest("hex");
}
