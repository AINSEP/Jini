/** Pure root-key provisioning decisions over already resolved material; no source reads or writes. */
import { fingerprintRootKeyHex, type ParsedRootKeyHex, type RootKeyRejection } from "../keyring.env.js";

/** The pure table's outcomes only. `"mismatch"` is a post-hoc reconciliation outcome: the table
 * never sees the host's stamped fingerprint. Keeping it out of the plan lets an effect executor
 * switch exhaustively over real planned outcomes without a dead `"mismatch"` case. Production
 * returns before local execution, so that executor needs no `"production-noop"` case either. */
export type SiteKeyEnsurePlanAction = "noop" | "adopt" | "mint" | "refuse" | "invalid" | "production-noop";

export interface SiteKeyEnsurePlan {
  readonly action: SiteKeyEnsurePlanAction;
}

/** Full provisioning result range, including a fingerprint mismatch discovered after planning. */
export type SiteKeyEnsureAction = SiteKeyEnsurePlanAction | "mismatch";

/** Only what the table needs; material and rejection payloads stay with the caller. */
export type SiteKeyMaterialCheck = { readonly kind: "absent" } | { readonly kind: "valid" } | { readonly kind: "invalid" };

export interface PlanSiteKeyEnsureInput {
  readonly mode: "production" | "local";
  /** The current key's material check. Location and source selection belong to the host. */
  readonly perSite: SiteKeyMaterialCheck;
  /** Other candidate: the source holding the stamped key when any does, otherwise the first
   * present source. The host excludes the current key's source before resolving this check. */
  readonly other: SiteKeyMaterialCheck;
  /** Irrelevant unless both checks are absent; callers may pass false otherwise. */
  readonly siteDbsWithKeyData: boolean;
}

/**
 * Pure provisioning table, in priority order:
 *
 * 1. Production never touches a per-site file: preserve the host's existing source mechanism.
 * 2. Valid per-site material is a no-op: fill gaps, never repair an already usable key.
 * 3. Invalid per-site material is reported, never treated as absent or overwritten.
 * 4. Per-site absent, other valid material: adopt those exact bytes so data stays decryptable.
 * 5. Per-site absent, other invalid material: report it; adoption would only move the breakage.
 * 6. Both absent with key-dependent data: refuse a fresh key that would orphan that data.
 * 7. Only after every other check passes may a new key be minted.
 *
 * @complexity O(1) time and space over already computed inputs.
 */
export function planSiteKeyEnsure(input: PlanSiteKeyEnsureInput, _optional = {}): SiteKeyEnsurePlan {
  if (input.mode === "production") return { action: "production-noop" };
  const decision = decideLocalSiteKeyEnsure({
    perSite: verdictOfCheck({ check: input.perSite }),
    other: verdictOfCheck({ check: input.other }),
    siteDbsWithKeyData: input.siteDbsWithKeyData,
  });
  return { action: decision.action };
}

/** A check carrying valid material (V) or a rejection (I). Effect dispatch receives the payload
 * the decision was made on, without extra guards inferring material from an action alone. */
export type SiteKeyVerdict<V, I> = { readonly kind: "absent" } | { readonly kind: "valid"; readonly value: V } | { readonly kind: "invalid"; readonly value: I };

/** Local rows only; production is decided before this table is reached. */
export type LocalSiteKeyDecision<V, I> =
  | { readonly action: "noop" | "adopt"; readonly value: V }
  | { readonly action: "invalid"; readonly value: I }
  | { readonly action: "refuse" | "mint" };

/** Rows 2–7 of {@link planSiteKeyEnsure}, preserving the selected material or rejection.
 * @complexity O(1) time and space.
 */
export function decideLocalSiteKeyEnsure<V, I>(input: {
  perSite: SiteKeyVerdict<V, I>;
  other: SiteKeyVerdict<V, I>;
  siteDbsWithKeyData: boolean;
}, _optional = {}): LocalSiteKeyDecision<V, I> {
  if (input.perSite.kind === "valid") return { action: "noop", value: input.perSite.value };
  if (input.perSite.kind === "invalid") return { action: "invalid", value: input.perSite.value };
  // perSite.kind === "absent" from here on.
  if (input.other.kind === "valid") return { action: "adopt", value: input.other.value };
  if (input.other.kind === "invalid") return { action: "invalid", value: input.other.value };
  // other.kind === "absent" too — nothing anywhere.
  if (input.siteDbsWithKeyData) return { action: "refuse" };
  return { action: "mint" };
}

/** Convert payload-free checks for the same local table used by material-bearing callers. */
export function verdictOfCheck(
  { check }: { check: SiteKeyMaterialCheck },
  _optional = {},
): SiteKeyVerdict<undefined, undefined> {
  return check.kind === "absent" ? check : { kind: check.kind, value: undefined };
}

/** Convert an existing parse result, or absence, without revalidating or normalizing material. */
export function verdictOf(
  { parsed }: { parsed: ParsedRootKeyHex | undefined },
  _optional = {},
): SiteKeyVerdict<string, RootKeyRejection> {
  if (parsed === undefined) return { kind: "absent" };
  return parsed.ok ? { kind: "valid", value: parsed.hex } : { kind: "invalid", value: parsed.reason };
}

/** Whether validated material matches the host's stamp, using the keyring's byte fingerprint.
 * @complexity O(k) time and space for k hex characters; no source access.
 */
export function matchesFingerprint(
  { parsed, fingerprint }: { parsed: ParsedRootKeyHex | undefined; fingerprint: string | undefined },
  _optional = {},
): boolean {
  return parsed?.ok === true && fingerprint !== undefined && fingerprintRootKeyHex({ hex: parsed.hex }) === fingerprint;
}
