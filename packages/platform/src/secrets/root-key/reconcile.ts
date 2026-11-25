import { decideLocalSiteKeyEnsure, matchesFingerprint, verdictOf, type SiteKeyVerdict } from "./decide.js";
import { fingerprintRootKeyHex, parseRootKeyHex, type RootKeyRejection } from "../keyring.env.js";

type Empty = Record<string, never>;

/** Reads one key source's raw material, or undefined when absent. Called lazily, in source order. */
export type RootKeyMaterialRead = (required: Empty, _optional?: Empty) => string | undefined;

/** The meta-file stamp as read at reconciliation time. `write` merges into the SAME parsed object. */
export type RootKeyStampRead =
  | { readonly kind: "no-meta" }
  | { readonly kind: "meta"; readonly fingerprint: string | undefined; readonly write: (required: { fingerprint: string }, _optional?: Empty) => void };

export interface RootKeyReconcilePorts {
  /** Raw per-site file material (undefined = absent). Read exactly once, first. */
  readonly readPerSite: RootKeyMaterialRead;
  /** Every OTHER source, in the host's precedence order. */
  readonly others: readonly RootKeyMaterialRead[];
  /** The stamped fingerprint as resolved BEFORE any write (host: resolveSiteKeyFingerprint). */
  readonly stampedFingerprint: string | undefined;
  /** Key-dependent-data scan. The reconciler memoizes it: at most one call per reconcile. */
  readonly hasDependentData: (required: Empty, _optional?: Empty) => Promise<boolean>;
  /** Move the per-site file aside only if it still holds `expectedContent`. Never deletes. */
  readonly moveAside: (required: { expectedContent: string }, _optional?: Empty) => void;
  /** Exclusive create of the per-site file; returns the trimmed bytes actually on disk (race winner). */
  readonly createExclusive: (required: { hex: string }, _optional?: Empty) => string;
  /** Fresh random key hex. */
  readonly mint: (required: Empty, _optional?: Empty) => string;
  /** Read the stamp again AFTER the key file has settled (host: readSiteMetaJson). */
  readonly readStamp: (required: Empty, _optional?: Empty) => RootKeyStampRead;
}

export type RootKeyReconcileResult =
  | { readonly action: "noop" | "adopt" | "mint" | "mismatch"; readonly fingerprint: string }
  | { readonly action: "invalid"; readonly reason: RootKeyRejection }
  | { readonly action: "refuse" };

export async function reconcileRootKey({ ports }: { ports: RootKeyReconcilePorts }, _optional: Empty = {}): Promise<RootKeyReconcileResult> {
  const perSiteRaw = ports.readPerSite({});
  const perSiteParsed = perSiteRaw === undefined ? undefined : parseRootKeyHex({ raw: perSiteRaw });

  // A source holding exactly the key `.site-meta.json` names is the right one to adopt wherever it
  // sits in the order; only without such a source does the first-present rule apply.
  const stampedFingerprint = ports.stampedFingerprint;
  const stampedHex = findStampedHex({ others: ports.others, stampedFingerprint });

  // A per-site file the stamp does not name (a different key, or malformed) while another source
  // holds the stamped key: the per-site file would otherwise outrank the right key forever. It is
  // moved aside, never deleted, and the stamped key takes its place.
  if (perSiteRaw !== undefined && stampedHex !== undefined && !matchesFingerprint({ parsed: perSiteParsed, fingerprint: stampedFingerprint })) {
    ports.moveAside({ expectedContent: perSiteRaw });
    const written = ports.createExclusive({ hex: stampedHex });
    return reconcileStamp({ ports, action: "adopt", fingerprint: fingerprintRootKeyHex({ hex: written }), mayRestamp: neverRestamp });
  }

  const otherRaw = stampedHex === undefined ? firstPresent({ others: ports.others }) : undefined;
  return settle({
    ports,
    perSite: verdictOf({ parsed: perSiteParsed }),
    other: stampedHex !== undefined ? { kind: "valid", value: stampedHex } : verdictOf({ parsed: otherRaw === undefined ? undefined : parseRootKeyHex({ raw: otherRaw }) }),
    stampedFingerprint,
  });
}

/** `ensureSiteKey` once no stamped key has to displace the per-site file: decides by the table
 *  ({@link decideLocalSiteKeyEnsure}) and carries out that one outcome. */
async function settle(required: {
  ports: RootKeyReconcilePorts;
  perSite: SiteKeyVerdict<string, RootKeyRejection>;
  other: SiteKeyVerdict<string, RootKeyRejection>;
  stampedFingerprint: string | undefined;
}): Promise<RootKeyReconcileResult> {
  const { ports, perSite, other } = required;
  let hasKeyDataMemo: boolean | undefined;
  const siteHasKeyData = async (): Promise<boolean> => {
    hasKeyDataMemo ??= await ports.hasDependentData({});
    return hasKeyDataMemo;
  };
  const needsDataCheck = perSite.kind === "absent" && other.kind === "absent";
  const siteDbsWithKeyData = needsDataCheck ? await siteHasKeyData() : false;

  const decision = decideLocalSiteKeyEnsure({ perSite, other, siteDbsWithKeyData });

  switch (decision.action) {
    case "noop":
      return reconcileStamp({ ports, action: "noop", fingerprint: fingerprintRootKeyHex({ hex: decision.value }), mayRestamp: neverRestamp });
    case "invalid":
      return { action: "invalid", reason: decision.value };
    case "adopt":
      return adopt({ ports, hex: decision.value, stampedFingerprint: required.stampedFingerprint, siteHasKeyData });
    case "refuse":
      return { action: "refuse" };
    case "mint": {
      const written = ports.createExclusive({ hex: ports.mint({}) });
      // `mint` is only planned when the site has no key-dependent data, so a stale stamp (a moved or
      // copied site folder) protects nothing — it is replaced rather than left as a permanent,
      // false "mismatch".
      return reconcileStamp({ ports, action: "mint", fingerprint: fingerprintRootKeyHex({ hex: written }), mayRestamp: async () => !(await siteHasKeyData()) });
    }
    default: {
      const unhandled: never = decision;
      throw new TypeError(`Unknown site key decision: ${String(unhandled)}`);
    }
  }
}

/** The `"adopt"` outcome: copies `hex` (another source's valid key) into the per-site file. */
async function adopt(required: {
  ports: RootKeyReconcilePorts;
  hex: string;
  stampedFingerprint: string | undefined;
  siteHasKeyData: () => Promise<boolean>;
}): Promise<RootKeyReconcileResult> {
  const { ports, hex, stampedFingerprint, siteHasKeyData } = required;
  // The stamp is checked BEFORE the write: once a per-site file exists it outranks every other
  // source, so adopting a key the stamp already proves wrong would make it permanent and block
  // the right key from ever being adopted. With no key-dependent data the stamp protects
  // nothing, so adoption goes ahead and the stamp is updated.
  const candidateFingerprint = fingerprintRootKeyHex({ hex });
  if (stampedFingerprint !== undefined && stampedFingerprint !== candidateFingerprint && (await siteHasKeyData())) {
    return { action: "mismatch", fingerprint: candidateFingerprint };
  }
  const written = ports.createExclusive({ hex });
  return reconcileStamp({ ports, action: "adopt", fingerprint: fingerprintRootKeyHex({ hex: written }), mayRestamp: async () => !(await siteHasKeyData()) });
}

/** `mayRestamp` for outcomes that never re-stamp (`"noop"`, and replacing a per-site file with the
 *  stamped key): a differing stamp there is evidence, reported as `"mismatch"`. */
const neverRestamp = async (): Promise<boolean> => false;

/**
 * Site-key plan §A.2's fingerprint stamp / §A.4: after `ensureSiteKey` settles on the key now
 * actually in the per-site file (`"noop"`, `"adopt"`, or `"mint"`), makes sure `.site-meta.json`
 * records that key's fingerprint — atomically, and preserving every other field in the file — so a
 * LATER substitution of the physical key file becomes visible before any decrypt ever fails on it
 * (§A.5's `"mismatch"` banner state).
 *
 * - No readable/parseable `.site-meta.json` at `siteDir` → nothing to stamp against; the caller's
 *   own key-material outcome is untouched. This keeps every pre-A4 `ensureSiteKey` caller (a raw
 *   temp `siteDir` with no meta file at all, e.g. this module's own unit-test fixtures) working
 *   exactly as before this stamp existed.
 * - Field absent → stamped now, merged into the EXISTING parsed object so no other field is lost or
 *   reset (never a fresh object built from scratch).
 * - Field present and equal → nothing written; the file already reflects reality.
 * - Field present and different, and `mayRestamp()` is false (the site has key-dependent data, or
 *   the caller is `"noop"`) → the stamp is evidence, not a cache: this call returns `"mismatch"`
 *   instead of the caller's own action and does not rewrite `.site-meta.json`.
 * - Field present and different, and `mayRestamp()` is true (`"mint"`/`"adopt"` on a site with no
 *   key-dependent data — nothing sealed under the stamped key can be orphaned) → re-stamped to the
 *   key now in the file, and the caller's own action is returned.
 *
 * @complexity O(1) — one bounded JSON read, at most one atomic JSON write.
 */
async function reconcileStamp(
  {
    ports,
    action,
    fingerprint,
    mayRestamp,
  }: {
    ports: RootKeyReconcilePorts;
    action: "noop" | "adopt" | "mint";
    fingerprint: string;
    mayRestamp: () => Promise<boolean>;
  },
  _optional = {}
): Promise<RootKeyReconcileResult> {
  // `readSiteMetaJson` (site-key-sources.ts) — the shared `.site-meta.json` parse both this
  // function and `site-key-sources.ts`'s own `resolveSiteKeyId`/`resolveSiteKeyFingerprint` build
  // on, so a corrupt-file/non-object verdict can never drift between the writer's own
  // reconciliation and the admin route's read-only state derivation.
  const stamp = ports.readStamp({});
  if (stamp.kind === "no-meta") {
    return { action, fingerprint };
  }
  const stamped = stamp.fingerprint;
  if (stamped === undefined) {
    stamp.write({ fingerprint });
    return { action, fingerprint };
  }
  if (stamped === fingerprint) {
    return { action, fingerprint };
  }
  if (await mayRestamp()) {
    stamp.write({ fingerprint });
    return { action, fingerprint };
  }
  return { action: "mismatch", fingerprint };
}

/** The (trimmed) key of the first source in `sources` holding a valid key whose fingerprint is
 *  `stampedFingerprint`, or `undefined` when nothing is stamped or no source matches. A match is
 *  proof it is the key the site's data was sealed with, so a broken or different source earlier in
 *  the order does not hide it.
 *  @complexity O(n) in `sources.length` — one read and one hash per source. */
function findStampedHex(
  {
    others,
    stampedFingerprint,
  }: {
    others: readonly RootKeyMaterialRead[];
    stampedFingerprint: string | undefined;
  },
  _optional = {}
): string | undefined {
  if (stampedFingerprint === undefined) return undefined;
  for (const source of others) {
    const raw = source({});
    const parsed = raw === undefined ? undefined : parseRootKeyHex({ raw });
    if (parsed?.ok && fingerprintRootKeyHex({ hex: parsed.hex }) === stampedFingerprint) return parsed.hex;
  }
  return undefined;
}

/** The first source in `sources` that has ANY material — present-but-invalid still counts and
 *  stops the scan (site-key plan §A.2: adopting silently past a broken source would still be
 *  wrong, the same reasoning `keyring.env.ts`'s own env-then-file resolution already follows). */
function firstPresent({ others }: { others: readonly RootKeyMaterialRead[] }): string | undefined {
  for (const source of others) {
    const raw = source({});
    if (raw !== undefined) return raw;
  }
  return undefined;
}

