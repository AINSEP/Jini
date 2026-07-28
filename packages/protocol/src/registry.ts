/**
 * Wire-type schemas for a plugin/skill registry (marketplace) protocol: entries, versions,
 * search, publish/yank outcomes, and the async `RegistryBackend` contract every concrete
 * backend (GitHub-hosted, HTTP, local filesystem, database-backed) implements. Pure zod
 * schemas + inferred types — no runtime/backend logic lives here, matching this package's
 * "pure wire types" charter (see `run.ts`/`events.ts`/`errors.ts` for the same pattern).
 */
import { z } from 'zod';

export const RegistryBackendKindSchema = z.enum(['github', 'http', 'local', 'db']);
export type RegistryBackendKind = z.infer<typeof RegistryBackendKindSchema>;

export const RegistryTrustSchema = z.enum(['official', 'trusted', 'restricted']);
export type RegistryTrust = z.infer<typeof RegistryTrustSchema>;

export const RegistryDistSchema = z
  .object({
    type: z.enum(['github-release', 'https-archive', 'local-archive', 'database']).optional(),
    archive: z.string().min(1).optional(),
    integrity: z.string().min(1).optional(),
    manifestDigest: z.string().min(1).optional(),
  })
  .passthrough();
export type RegistryDist = z.infer<typeof RegistryDistSchema>;

export const RegistryPublisherSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    github: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
    verified: z.boolean().optional(),
  })
  .passthrough();
export type RegistryPublisher = z.infer<typeof RegistryPublisherSchema>;

export const RegistryMetricsSchema = z
  .object({
    downloads: z.number().int().nonnegative().optional(),
    installs: z.number().int().nonnegative().optional(),
    stars: z.number().int().nonnegative().optional(),
    updatedAt: z.string().optional(),
    lastPublishedAt: z.string().optional(),
  })
  .passthrough();
export type RegistryMetrics = z.infer<typeof RegistryMetricsSchema>;

export const RegistrySignatureSchema = z
  .object({
    kind: z.enum(['github-oidc', 'cosign', 'minisign', 'custom']),
    issuer: z.string().min(1).optional(),
    subject: z.string().min(1).optional(),
    signature: z.string().min(1),
    certificate: z.string().min(1).optional(),
    signedAt: z.string().optional(),
  })
  .passthrough();
export type RegistrySignature = z.infer<typeof RegistrySignatureSchema>;

export const RegistryVersionSchema = z
  .object({
    version: z.string().min(1),
    source: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
    dist: RegistryDistSchema.optional(),
    integrity: z.string().min(1).optional(),
    manifestDigest: z.string().min(1).optional(),
    deprecated: z.union([z.boolean(), z.string()]).optional(),
    yanked: z.boolean().optional(),
    yankedAt: z.string().optional(),
    yankReason: z.string().optional(),
  })
  .passthrough();
export type RegistryVersion = z.infer<typeof RegistryVersionSchema>;

/** `name` is a stable `vendor/plugin-name` id — the registry's primary key shape. */
export const RegistryEntrySchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/),
    version: z.string().min(1),
    source: z.string().min(1),
    ref: z.string().min(1).optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    capabilitiesSummary: z.array(z.string()).optional(),
    dist: RegistryDistSchema.optional(),
    versions: z.array(RegistryVersionSchema).optional(),
    distTags: z.record(z.string()).optional(),
    integrity: z.string().min(1).optional(),
    manifestDigest: z.string().min(1).optional(),
    publisher: RegistryPublisherSchema.optional(),
    homepage: z.string().optional(),
    license: z.string().optional(),
    deprecated: z.union([z.boolean(), z.string()]).optional(),
    yanked: z.boolean().optional(),
    yankedAt: z.string().optional(),
    yankReason: z.string().optional(),
    metrics: RegistryMetricsSchema.optional(),
    signatures: z.array(RegistrySignatureSchema).optional(),
  })
  .passthrough();
export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;

/**
 * A registry's whole published index: one or more {@link RegistryEntry}
 * records under a spec/name/version envelope. This is the generic shape a
 * `static`/`github`/`database` backend reads from or writes to — the direct
 * counterpart of a package registry's index.json / a plugin marketplace's
 * manifest, with no vendor-specific fields.
 */
export const RegistryManifestSchema = z
  .object({
    specVersion: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1),
    entries: z.array(RegistryEntrySchema),
  })
  .passthrough();
export type RegistryManifest = z.infer<typeof RegistryManifestSchema>;

export const RegistryListFilterSchema = z
  .object({
    query: z.string().optional(),
    tags: z.array(z.string()).optional(),
    publisher: z.string().optional(),
    includeYanked: z.boolean().optional(),
  })
  .optional();
export type RegistryListFilter = z.infer<typeof RegistryListFilterSchema>;

export const RegistrySearchQuerySchema = z.object({
  query: z.string().default(''),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(500).optional(),
  includeYanked: z.boolean().optional(),
});
export type RegistrySearchQuery = z.infer<typeof RegistrySearchQuerySchema>;

export const RegistrySearchResultSchema = z.object({
  entry: RegistryEntrySchema,
  score: z.number().nonnegative(),
  matched: z.array(z.string()),
});
export type RegistrySearchResult = z.infer<typeof RegistrySearchResultSchema>;

export const ResolvedRegistryEntrySchema = z.object({
  backendId: z.string().min(1),
  backendKind: RegistryBackendKindSchema,
  trust: RegistryTrustSchema,
  /**
   * Whether at least one of `entry.signatures[]` was cryptographically
   * verified against the resolving backend's configured trust root.
   * Additive alongside `trust`, never a replacement for it: `trust` still
   * reports the backend-configured level exactly as before (config-asserted,
   * "which backend object a host happened to construct"); `verified` reports
   * whether that claim also has cryptographic backing. A backend with no
   * trust root configured (the default, unchanged from before this field
   * existed) always resolves entries with `verified: false` — this field
   * never throws and never changes what `trust` means. See
   * `@injini/registry`'s `trust.ts` for the verifier.
   */
  verified: z.boolean().default(false),
  /** Present only when `verified` is `true` — the verified signature's OIDC issuer. */
  verifiedIssuer: z.string().optional(),
  /** Present only when `verified` is `true` — the verified signature's signer identity. */
  verifiedSubject: z.string().optional(),
  entry: RegistryEntrySchema,
  version: RegistryVersionSchema,
  source: z.string().min(1),
  ref: z.string().optional(),
  integrity: z.string().optional(),
  manifestDigest: z.string().optional(),
});
export type ResolvedRegistryEntry = z.infer<typeof ResolvedRegistryEntrySchema>;

export const RegistryPublishRequestSchema = z.object({
  entry: RegistryEntrySchema,
  packagePath: z.string().optional(),
  dryRun: z.boolean().optional(),
  tag: z.string().optional(),
  changelog: z.string().optional(),
});
export type RegistryPublishRequest = z.infer<typeof RegistryPublishRequestSchema>;

export const RegistryPublishOutcomeSchema = z.object({
  ok: z.boolean(),
  dryRun: z.boolean().optional(),
  pullRequestUrl: z.string().optional(),
  changedFiles: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});
export type RegistryPublishOutcome = z.infer<typeof RegistryPublishOutcomeSchema>;

export const RegistryDoctorIssueSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  code: z.string().min(1),
  message: z.string().min(1),
  pluginName: z.string().optional(),
});
export type RegistryDoctorIssue = z.infer<typeof RegistryDoctorIssueSchema>;

export const RegistryDoctorReportSchema = z.object({
  ok: z.boolean(),
  backendId: z.string().min(1),
  checkedAt: z.number(),
  entriesChecked: z.number().int().nonnegative(),
  issues: z.array(RegistryDoctorIssueSchema),
});
export type RegistryDoctorReport = z.infer<typeof RegistryDoctorReportSchema>;

export const RegistryYankOutcomeSchema = z.object({
  ok: z.boolean(),
  dryRun: z.boolean().optional(),
  name: z.string().min(1),
  version: z.string().min(1),
  reason: z.string().min(1),
  pullRequestUrl: z.string().optional(),
  warnings: z.array(z.string()).default([]),
});
export type RegistryYankOutcome = z.infer<typeof RegistryYankOutcomeSchema>;

/** One concrete registry source (a GitHub-hosted index, an HTTP endpoint, a local dir, a DB). */
export interface RegistryBackend {
  readonly id: string;
  readonly kind: RegistryBackendKind;
  readonly trust: RegistryTrust;

  list(filter?: RegistryListFilter): Promise<RegistryEntry[]>;
  search(query: RegistrySearchQuery): Promise<RegistrySearchResult[]>;
  resolve(name: string, range?: string): Promise<ResolvedRegistryEntry | null>;
  manifest(name: string, version: string): Promise<RegistryEntry | null>;
  doctor(): Promise<RegistryDoctorReport>;

  publish?(request: RegistryPublishRequest): Promise<RegistryPublishOutcome>;
  yank?(name: string, version: string, reason: string): Promise<RegistryYankOutcome>;
}

/** Constructs a `RegistryBackend` of a given kind from backend-specific config. */
export interface RegistryBackendFactory<TConfig = unknown> {
  readonly kind: RegistryBackendKind;
  create(config: TConfig): RegistryBackend;
}
