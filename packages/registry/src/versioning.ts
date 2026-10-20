/**
 * @module versioning
 *
 * Registry-entry specifier parsing (`vendor/name@range`) and npm-style
 * semver-range resolution (`^`/`~`/dist-tag/exact) against a
 * {@link RegistryEntry}'s `versions` array. Pure — no I/O, no backend
 * dependency. Shared by every `RegistryBackend` implementation in this
 * package (`static`/`github`/`database`) so version-resolution semantics
 * stay identical across backend kind.
 */
import type { RegistryEntry } from '@jini-ai/protocol';

export interface ParsedRegistrySpecifier {
  name: string;
  range?: string;
}

export interface ResolvedRegistryEntryVersion {
  version: string;
  source: string;
  ref?: string;
  manifestDigest?: string;
  archiveIntegrity?: string;
  deprecated?: boolean | string;
}

/**
 * Split a `vendor/name` or `vendor/name@range` specifier into its name and
 * optional range. A bare `@` with nothing after it (`vendor/name@`) is
 * treated as no range, matching how an empty trailing segment is dropped.
 *
 * @param input - The raw specifier string.
 * @returns The parsed `{ name, range? }`.
 */
export function parseRegistrySpecifier({ input }: { input: string }): ParsedRegistrySpecifier {
  const trimmed = input.trim();
  const slash = trimmed.indexOf('/');
  const at = trimmed.lastIndexOf('@');
  if (slash > 0 && at > slash + 1) {
    const range = trimmed.slice(at + 1);
    return range ? { name: trimmed.slice(0, at), range } : { name: trimmed.slice(0, at) };
  }
  return { name: trimmed };
}

/**
 * Resolve which of a {@link RegistryEntry}'s versions satisfies a requested
 * range, following npm-style precedence: an explicit dist-tag, then an
 * exact version string, then `^`/`~` range matching against non-yanked,
 * non-prerelease-excluded candidates (unless the range itself pins a
 * prerelease). Falls back to the entry's `distTags.latest` / top-level
 * `version` when no range is requested. Returns `null` when the entry (or
 * the resolved version) is yanked, or when nothing satisfies the range.
 *
 * @param entry - The registry entry to resolve a version against.
 * @param requestedRange - An optional exact version, dist-tag, or `^`/`~` range.
 * @returns The resolved version's source/ref/integrity/digest, or `null`.
 */
export function resolveRegistryEntryVersion(
  { entry }: { entry: RegistryEntry },
  { requestedRange }: { requestedRange?: string | undefined } = {},
): ResolvedRegistryEntryVersion | null {
  if (entry.yanked) return null;

  const versions = entry.versions ?? [];
  const targetVersion = pickTargetVersion(entry, versions, requestedRange?.trim());
  return targetVersion ? resolveTargetVersion(entry, versions, targetVersion) : null;
}

type RegistryVersionRecord = NonNullable<RegistryEntry['versions']>[number];

/** Attach source and optional fields to an already-chosen version; `null` when that version is yanked or has no source. */
function resolveTargetVersion(
  entry: RegistryEntry,
  versions: RegistryVersionRecord[],
  targetVersion: string,
): ResolvedRegistryEntryVersion | null {
  const versionRecord = versions.find((version) => version.version === targetVersion);
  if (versionRecord?.yanked) return null;

  const source = versionRecord?.source ?? entry.source;
  if (!source) return null;

  return { version: targetVersion, source, ...optionalVersionFields(versionRecord, entry) };
}

/** No range (or `latest`) resolves the entry's default version; anything else must be proven by {@link resolveRequestedVersion}. */
function pickTargetVersion(
  entry: RegistryEntry,
  versions: RegistryVersionRecord[],
  range: string | undefined,
): string | null | undefined {
  if (range && range !== 'latest') return resolveRequestedVersion(entry, range);
  return entry.distTags?.['latest'] ?? entry.version ?? versions.find((version) => !version.yanked)?.version;
}

/** The resolved version's ref/digest/integrity/deprecation, preferring the version record over the entry; absent values are omitted. */
function optionalVersionFields(
  record: RegistryVersionRecord | undefined,
  entry: RegistryEntry,
): Omit<ResolvedRegistryEntryVersion, 'version' | 'source'> {
  const fields: Omit<ResolvedRegistryEntryVersion, 'version' | 'source'> = {};
  const ref = record?.ref ?? entry.ref;
  if (ref) fields.ref = ref;
  const manifestDigest = distField(record, entry, 'manifestDigest');
  if (manifestDigest) fields.manifestDigest = manifestDigest;
  const archiveIntegrity = distField(record, entry, 'integrity');
  if (archiveIntegrity) fields.archiveIntegrity = archiveIntegrity;
  const deprecated = record?.deprecated ?? entry.deprecated;
  if (deprecated !== undefined) fields.deprecated = deprecated;
  return fields;
}

/** First of record field, record `dist` field, entry field, entry `dist` field. */
function distField(
  record: RegistryVersionRecord | undefined,
  entry: RegistryEntry,
  key: 'manifestDigest' | 'integrity',
): string | undefined {
  return record?.[key] ?? record?.dist?.[key] ?? entry[key] ?? entry.dist?.[key];
}

/**
 * Resolve an exact-version request or dist-tag lookup to a version string
 * that is *proven* to exist in `entry.versions` (and is not yanked) before
 * it is ever handed back to a caller alongside a source/integrity payload.
 *
 * Without this check, a caller could request a version that has no record
 * in `entry.versions` and still receive the top-level entry's source/ref/
 * integrity — silently mislabeling those bytes with the requested (but
 * nonexistent) version number. See CR-008.
 *
 * The one legacy exception: an entry that declares no `versions` ledger at
 * all (a single-version registry entry) is allowed to resolve an exact
 * request that matches its own top-level `version` — there is no ledger to
 * be authoritative over in that case, and the top-level fields *are* that
 * version's source/integrity by construction.
 */
function resolveRequestedVersion(entry: RegistryEntry, range: string): string | null {
  const versions = entry.versions ?? [];
  const distTags = entry.distTags ?? {};

  const tagged = distTags[range];
  if (tagged) {
    return versionExists(versions, entry, tagged) ? tagged : null;
  }
  if (!range.startsWith('^') && !range.startsWith('~')) {
    return versionExists(versions, entry, range) ? range : null;
  }

  const base = parseSemver(range.slice(1));
  if (!base) return null;
  const caret = range.startsWith('^');
  const candidates = versions
    .filter((version) => !version.yanked)
    .map((version) => version.version)
    .filter((version) => {
      const parsed = parseSemver(version);
      return parsed !== null && rangeAdmits(parsed, base, caret);
    })
    .sort((left, right) => compareSemver(parseSemver(right)!, parseSemver(left)!));
  return candidates[0] ?? null;
}

/**
 * True when `version` is a real, non-yanked version of `entry`: either a
 * matching, non-yanked record in `entry.versions`, or — only when
 * `entry.versions` declares no ledger at all — an exact match against the
 * entry's own top-level `version` (the legacy single-version case).
 *
 * A version that *is* present in `entry.versions` but yanked is explicitly
 * rejected here rather than left for the caller to notice later, so a
 * yanked exact-version/dist-tag request can never resolve.
 */
function versionExists(versions: NonNullable<RegistryEntry['versions']>, entry: RegistryEntry, version: string): boolean {
  const record = versions.find((candidate) => candidate.version === version);
  if (record) return !record.yanked;
  // No versions ledger at all (not just "this version is missing from it")
  // — fall back to treating the entry's own top-level version as the one
  // version this entry has.
  return versions.length === 0 && entry.version === version;
}

/** True when `parsed` satisfies the `^`/`~` range whose base is `base`. */
function rangeAdmits(parsed: SemverParts, base: SemverParts, caret: boolean): boolean {
  // npm excludes prerelease candidates from a range unless the range is
  // itself a prerelease of the same major.minor.patch tuple (so `^0.2.0`
  // never matches `0.2.1-beta.1`, but `^0.2.1-beta.1` matches 0.2.1-beta.2).
  if (parsed.prerelease && !(base.prerelease && sameCore(parsed, base))) return false;
  const locked = caret ? caretLocked(parsed, base) : parsed.major === base.major && parsed.minor === base.minor;
  return locked && compareSemver(parsed, base) >= 0;
}

/**
 * npm caret locks the leftmost non-zero component: `^1.2.3` allows
 * `<2.0.0`, but `^0.2.3` only `<0.3.0` and `^0.0.3` only `<0.0.4`.
 * Locking major alone wrongly resolves `^0.2.0` to a breaking `0.3.0`.
 */
function caretLocked(parsed: SemverParts, base: SemverParts): boolean {
  if (parsed.major !== base.major) return false;
  if (base.major !== 0) return true;
  if (parsed.minor !== base.minor) return false;
  return base.minor !== 0 || parsed.patch === base.patch;
}

function sameCore(left: SemverParts, right: SemverParts): boolean {
  return left.major === right.major && left.minor === right.minor && left.patch === right.patch;
}

interface SemverParts {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

function parseSemver(value: string): SemverParts | null {
  // Capture an optional `-prerelease`; `+build` metadata is ignored for
  // precedence (semver §10). The prerelease drives npm's caret/tilde exclusion.
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([^+]*))?(?:\+.*)?$/.exec(value);
  if (!match) return null;
  // Groups 1-3 are mandatory `\d+` captures in the pattern above, so a
  // successful match always populates them — the non-null assertions are
  // TS-required (capture groups type as `string | undefined`) with no real
  // runtime path where they're actually absent.
  return {
    major: Number(match[1]!),
    minor: Number(match[2]!),
    patch: Number(match[3]!),
    prerelease: match[4] || null,
  };
}

function compareSemver(left: SemverParts, right: SemverParts): number {
  const core = left.major - right.major || left.minor - right.minor || left.patch - right.patch;
  if (core !== 0) return core;
  return comparePrerelease(left.prerelease, right.prerelease);
}

// semver §11 precedence: a normal release outranks a prerelease of the same
// core version; otherwise compare dot-separated identifiers left to right —
// numeric ones numerically and ranked below alphanumeric, and a longer set of
// identifiers wins when all preceding ones are equal.
function comparePrerelease(left: string | null, right: string | null): number {
  // A missing prerelease (a normal release) ranks above any prerelease.
  if (!left || !right) return Number(!left) - Number(!right);
  const a = left.split('.');
  const b = right.split('.');
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    const order = compareIdentifier(a[i]!, b[i]!);
    if (order !== 0) return order;
  }
  return Math.sign(a.length - b.length);
}

function compareIdentifier(x: string, y: string): number {
  const xNum = /^\d+$/.test(x);
  const yNum = /^\d+$/.test(y);
  if (xNum && yNum) return Math.sign(Number(x) - Number(y));
  if (xNum !== yNum) return xNum ? -1 : 1;
  if (x === y) return 0;
  return x < y ? -1 : 1;
}
