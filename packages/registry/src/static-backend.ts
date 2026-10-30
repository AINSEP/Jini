/**
 * @module static-backend
 *
 * A read-mostly `RegistryBackend` over an in-memory {@link RegistryManifest}:
 * list/search/resolve/doctor computed directly from `manifest.entries`, no
 * publish/yank support. The base class every other backend in this package
 * extends — `github-backend` loads one manifest snapshot during construction and adds
 * publish/yank over a GitHub PR mutation without refreshing that snapshot; `database-backend` overrides
 * `getManifest()` to read from sqlite and adds publish/yank as direct writes.
 */
import {
  RegistryBackendKindSchema,
  RegistryEntrySchema,
  RegistryListFilterSchema,
  RegistryPublishRequestSchema,
  RegistrySearchQuerySchema,
  RegistryTrustSchema,
  type RegistryBackend,
  type RegistryBackendKind,
  type RegistryDoctorReport,
  type RegistryEntry,
  type RegistryListFilter,
  type RegistryManifest,
  type RegistryPublishRequest,
  type RegistrySearchQuery,
  type RegistrySearchResult,
  type RegistryTrust,
  type ResolvedRegistryEntry,
} from '@jini-ai/protocol';
import type { Clock } from '@jini-ai/core/primitives';
import { parseRegistrySpecifier, resolveRegistryEntryVersion } from './versioning.js';
import { verifyRegistryEntrySignatures, type RegistryTrustRoot } from './trust.js';

export interface StaticRegistryBackendOptions {
  kind?: RegistryBackendKind;
  /** Inject the kernel clock for reproducible storage and diagnostic timestamps. */
  clock?: Clock;
  /**
   * Optional per-entry signature trust root (currently `github-oidc` only —
   * see `trust.ts`). Omitting this is the pre-existing, unchanged default:
   * `resolve()` reports `verified: false` for every entry without attempting
   * any verification. Configuring it turns on real cryptographic
   * verification of `entry.signatures[]`, additive alongside `trust` (see
   * `ResolvedRegistryEntrySchema.verified`'s doc comment in `@jini-ai/protocol`).
   */
  trustRoot?: RegistryTrustRoot | undefined;
}

export class StaticRegistryBackend implements RegistryBackend {
  readonly id: string;
  readonly kind: RegistryBackendKind;
  readonly trust: RegistryTrust;

  protected readonly manifestData: RegistryManifest;
  protected readonly trustRoot: RegistryTrustRoot | undefined;

  protected readonly clock: Clock;

  constructor(
    required: { id: string; trust: RegistryTrust; manifest: RegistryManifest },
    options: StaticRegistryBackendOptions = {},
  ) {
    this.id = required.id;
    // Trust is host policy, never inferred from the transport; reject unknown modes.
    this.kind = RegistryBackendKindSchema.parse(options.kind ?? 'http');
    this.trust = RegistryTrustSchema.parse(required.trust);
    this.manifestData = required.manifest;
    this.trustRoot = options.trustRoot;
    this.clock = options.clock ?? { nowMs: () => Date.now() };
  }

  async list(_required: Record<string, never>, filter: NonNullable<RegistryListFilter> = {}): Promise<RegistryEntry[]> {
    const parsedFilter = RegistryListFilterSchema.unwrap().parse(filter);
    return validEntries(this.getManifest()).filter(listFilterPredicate(parsedFilter));
  }

  async search(required: Pick<RegistrySearchQuery, 'query'>, optional: Omit<RegistrySearchQuery, 'query'> = {}): Promise<RegistrySearchResult[]> {
    const query = RegistrySearchQuerySchema.parse({ ...required, ...optional });
    const terms = queryTerms(query.query);
    const tags = lowercased(query.tags);
    // Pass `includeYanked` through to `list` so search honors the same
    // filter contract instead of unconditionally dropping yanked entries.
    const entries = await this.list({}, { includeYanked: query.includeYanked });
    return entries
      .flatMap((entry) => searchResultFor(entry, terms, tags))
      .sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name))
      .slice(0, query.limit ?? 100);
  }

  async resolve({ name }: { name: string }, { range }: { range?: string | undefined } = {}): Promise<ResolvedRegistryEntry | null> {
    const parsed = parseRegistrySpecifier({ input: range ? `${name}@${range}` : name });
    const entry = validEntries(this.getManifest()).find(
      (candidate) => candidate.name.toLowerCase() === parsed.name.toLowerCase(),
    );
    if (!entry) return null;
    const resolvedVersion = resolveRegistryEntryVersion({ entry }, { requestedRange: parsed.range });
    if (!resolvedVersion) return null;
    // Additive alongside `trust`: never replaces or narrows the
    // backend-configured trust level above, which is still stamped exactly
    // as before. A backend with no `trustRoot` configured (the unchanged
    // default) always resolves `verified: false` here without attempting
    // any cryptographic work — see `trust.ts`'s `verifyRegistryEntrySignatures`.
    // Verification must cover the version and digest returned to the caller,
    // rather than letting an older version inherit the top-level signature.
    const verification = verifyRegistryEntrySignatures({ entry: {
      ...entry,
      version: resolvedVersion.version,
      integrity: resolvedVersion.archiveIntegrity,
      manifestDigest: resolvedVersion.manifestDigest,
      dist: undefined,
    } }, { trustRoot: this.trustRoot });
    return {
      backendId: this.id,
      backendKind: this.kind,
      trust: this.trust,
      verified: verification.verified,
      ...(verification.verified && verification.issuer ? { verifiedIssuer: verification.issuer } : {}),
      ...(verification.verified && verification.subject ? { verifiedSubject: verification.subject } : {}),
      entry,
      version: {
        version: resolvedVersion.version,
        source: resolvedVersion.source,
        ref: resolvedVersion.ref,
        integrity: resolvedVersion.archiveIntegrity,
        manifestDigest: resolvedVersion.manifestDigest,
        deprecated: resolvedVersion.deprecated,
      },
      source: resolvedVersion.source,
      ref: resolvedVersion.ref,
      integrity: resolvedVersion.archiveIntegrity,
      manifestDigest: resolvedVersion.manifestDigest,
    };
  }

  async manifest({ name, version }: { name: string; version: string }): Promise<RegistryEntry | null> {
    const resolved = await this.resolve({ name }, { range: version });
    return resolved?.entry ?? null;
  }

  async doctor(_required: Record<string, never>): Promise<RegistryDoctorReport> {
    // Deliberately audits the RAW manifest entries (not the `validEntries()`
    // schema-filtered set `list`/`search`/`resolve` use) — doctor's whole
    // purpose is to surface malformed data, so silently dropping a bad entry
    // before doctor sees it would hide exactly the issue it exists to report.
    // Because these are RAW/unvalidated entries (a caller can hand a
    // manifest object that never went through `RegistryManifestSchema`),
    // every field is guarded before it is dereferenced — a value that isn't
    // even a plausible object (null/array/primitive) is reported as
    // malformed instead of throwing out of `doctor()` itself.
    //
    // The manifest *envelope* itself gets the same treatment: a backend can
    // hand this class a manifest whose `entries` isn't even an array at all
    // (e.g. `GithubRegistryBackend` reads a JSON file from a remote, less-
    // trusted source through an injected client with no schema guarantee).
    // Report that as one explicit issue instead of letting `for...of` throw
    // a bare `TypeError` out of a caller-facing diagnostic method.
    const rawEntries = manifestEntriesRaw(this.getManifest());
    const entries: unknown[] = Array.isArray(rawEntries) ? rawEntries : [];
    const issues: DoctorIssue[] = [
      ...(Array.isArray(rawEntries) ? [] : [{ ...MALFORMED_MANIFEST_ISSUE }]),
      ...entries.flatMap(doctorEntryIssues),
    ];
    return {
      ok: !issues.some((issue) => issue.severity === 'error'),
      backendId: this.id,
      checkedAt: this.clock.nowMs(),
      entriesChecked: entries.length,
      issues,
    };
  }

  protected getManifest(): RegistryManifest {
    return this.manifestData;
  }
}

/**
 * @internal Extract a manifest's raw `entries` value without assuming it is
 * an array. `RegistryManifestSchema` guarantees that shape for anything that
 * went through it, but a backend may hand this class a manifest that never
 * did (a raw JSON file read from a remote/less-trusted source, a host-
 * constructed object typed but not runtime-checked). Returns whatever the
 * value actually is so callers can decide how to report "not an array."
 */
function manifestEntriesRaw(manifest: RegistryManifest): unknown {
  return (manifest as { entries?: unknown } | null | undefined)?.entries;
}

/** @internal Drop any manifest entry that fails the wire schema rather than let a malformed entry propagate. Also
 * tolerates a manifest whose `entries` isn't an array at all — treated as no entries rather than a crash. */
function validEntries(manifest: RegistryManifest): RegistryEntry[] {
  const rawEntries = manifestEntriesRaw(manifest);
  const entries = Array.isArray(rawEntries) ? rawEntries : [];
  return entries.flatMap((entry) => {
    const parsed = RegistryEntrySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * Validate a public `publish()` caller's whole request against the
 * `RegistryPublishRequest` wire schema before any backend uses
 * `request.entry`'s fields to build a file path, PR body, or a row that is
 * persisted and later trusted to already be schema-shaped. Without this,
 * `database-backend.ts`'s `publish()` could write a row that permanently
 * breaks every future `list`/`search`/`resolve`/`doctor` call for the
 * backend — those all re-read the table and throw on a row that fails
 * `RegistryEntrySchema` (see `parseStoredEntry`) rather than silently
 * dropping it, on the theory that data *this backend itself wrote* should
 * always be well-formed; `publish()` is the one boundary that must enforce
 * that theory rather than assume it.
 *
 * Shared across backends (not just `DatabaseRegistryBackend`) so
 * `GithubRegistryBackend` also refuses to open a PR publishing a
 * genuinely malformed entry into a shared external manifest. Backend-
 * specific path/branch-name safety checks (`assertSafeEntryName`/
 * `assertSafeVersion` in `github-backend.ts`) still run independently —
 * this schema constrains `name`'s shape but not `version`'s character set,
 * so it is necessary but not sufficient for path safety on its own.
 *
 * @param request - The public `publish()` caller's request object.
 * @returns The schema-parsed (and thus schema-shaped) request.
 * @throws If `request` does not conform to `RegistryPublishRequestSchema`.
 */
export function assertValidPublishRequest(required: Pick<RegistryPublishRequest, 'entry'>, optional: Omit<RegistryPublishRequest, 'entry'> = {}): RegistryPublishRequest {
  const parsed = RegistryPublishRequestSchema.safeParse({ ...required, ...optional });
  if (!parsed.success) {
    throw new Error(`Invalid registry publish request: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** @internal The lowercase, space-joined text `list`/`search` match query terms against. */
function searchHaystack(entry: RegistryEntry): string {
  return [
    entry.name,
    entry.title ?? '',
    entry.description ?? '',
    ...(entry.tags ?? []),
    ...(entry.capabilitiesSummary ?? []),
    entry.publisher?.id ?? '',
    entry.publisher?.github ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

/** @internal Lowercase every string in an optional list. */
function lowercased(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.toLowerCase());
}

/** @internal Whitespace-separated, lowercased, non-empty query terms. */
function queryTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/g).filter(Boolean);
}

/** @internal True when the entry carries every one of the (already lowercased) `tags`; an empty list admits every entry. */
function hasEveryTag(entry: RegistryEntry, tags: string[]): boolean {
  const entryTags = new Set(lowercased(entry.tags));
  return tags.every((tag) => entryTags.has(tag));
}

/** @internal `list`'s filter: yanked, publisher id/github handle, every tag, and any query term — all case-insensitive. */
function listFilterPredicate(filter: NonNullable<RegistryListFilter>): (entry: RegistryEntry) => boolean {
  const publisher = filter.publisher?.toLowerCase();
  const tags = lowercased(filter.tags);
  const terms = queryTerms(filter.query ?? '');
  const visible = (entry: RegistryEntry): boolean => filter.includeYanked === true || !entry.yanked;
  const fromPublisher = (entry: RegistryEntry): boolean => !publisher || publishedBy(entry, publisher);
  const matchesQuery = (entry: RegistryEntry): boolean => terms.length === 0 || terms.some((term) => searchHaystack(entry).includes(term));
  return (entry) => visible(entry) && fromPublisher(entry) && hasEveryTag(entry, tags) && matchesQuery(entry);
}

/** @internal True when the (already lowercased) `publisher` is the entry's publisher id or GitHub handle. */
function publishedBy(entry: RegistryEntry, publisher: string): boolean {
  return entry.publisher?.id?.toLowerCase() === publisher || entry.publisher?.github?.toLowerCase() === publisher;
}

/** @internal `search`'s per-entry result: none when a tag is missing or no term matches, else the matched fraction of terms (0 for an empty query). */
function searchResultFor(entry: RegistryEntry, terms: string[], tags: string[]): RegistrySearchResult[] {
  if (!hasEveryTag(entry, tags)) return [];
  const haystack = searchHaystack(entry);
  const matched = terms.filter((term) => haystack.includes(term));
  if (terms.length > 0 && matched.length === 0) return [];
  return [{ entry, score: terms.length === 0 ? 0 : matched.length / terms.length, matched }];
}

type DoctorIssue = RegistryDoctorReport['issues'][number];

const MALFORMED_MANIFEST_ISSUE: DoctorIssue = {
  severity: 'error',
  code: 'malformed-manifest',
  message: 'Registry manifest "entries" is missing or not an array; no entries could be checked.',
};

/**
 * @internal The per-entry `doctor` checks, in report order. Each reads a RAW,
 * unvalidated entry, so every field is guarded before it is dereferenced.
 */
const DOCTOR_ENTRY_CHECKS: Array<{
  severity: DoctorIssue['severity'];
  code: string;
  message: string;
  failed: (candidate: Partial<RegistryEntry>, name: string | undefined) => boolean;
}> = [
  {
    severity: 'error',
    code: 'invalid-name',
    message: 'Registry entry name must be vendor/name.',
    // The schema rejects undefined and "" too, so no separate presence check.
    failed: (_candidate, name) => !RegistryEntrySchema.shape.name.safeParse(name).success,
  },
  {
    severity: 'error',
    code: 'missing-source',
    message: 'Registry entry must provide source or dist.archive.',
    failed: (candidate) => {
      const dist = candidate.dist && typeof candidate.dist === 'object' ? candidate.dist : undefined;
      return !candidate.source && !dist?.archive;
    },
  },
  {
    severity: 'warning',
    code: 'missing-license',
    message: 'Registry entry should declare a license.',
    failed: (candidate) => !candidate.license,
  },
  {
    severity: 'warning',
    code: 'missing-capabilities',
    message: 'Registry entry should summarize its capabilities.',
    failed: (candidate) => !Array.isArray(candidate.capabilitiesSummary) || candidate.capabilitiesSummary.length === 0,
  },
  {
    severity: 'error',
    code: 'missing-yank-reason',
    message: 'Yanked entries must keep a human-readable reason.',
    failed: (candidate) => Boolean(candidate.yanked) && !candidate.yankReason,
  },
];

/** @internal `doctor`'s issues for one raw manifest entry; a value that is not a plain object is one `malformed-entry` issue. */
function doctorEntryIssues(raw: unknown): DoctorIssue[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return [{ severity: 'error', code: 'malformed-entry', message: 'Registry entry is not a valid object and could not be checked.' }];
  }
  const candidate = raw as Partial<RegistryEntry>;
  const name = typeof candidate.name === 'string' ? candidate.name : undefined;
  return DOCTOR_ENTRY_CHECKS.filter((check) => check.failed(candidate, name)).map(({ severity, code, message }) => ({
    severity,
    code,
    message,
    pluginName: name,
  }));
}
