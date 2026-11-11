import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import {
  RegistryDistSchema,
  RegistryDoctorIssueSchema,
  RegistryDoctorReportSchema,
  RegistryEntrySchema,
  RegistryListFilterSchema,
  RegistryManifestSchema,
  RegistryPublishOutcomeSchema,
  RegistryPublishRequestSchema,
  RegistryMetricsSchema,
  RegistryPublisherSchema,
  RegistrySearchQuerySchema,
  RegistrySearchResultSchema,
  RegistrySignatureSchema,
  RegistryVersionSchema,
  RegistryYankOutcomeSchema,
  ResolvedRegistryEntrySchema,
} from '../registry.js';

/** Issue paths of a failed parse; asserting the path pins WHICH field was refused (AP1/AP8). */
function issuePaths(schema: ZodTypeAny, value: unknown): string[] {
  const result = schema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map(issue => issue.path.join('.'));
}

const entry = { name: 'vendor/example', version: '1.0.0', source: 'github:vendor/example' };
const version = { version: '1.0.0' };
const signature = { kind: 'cosign', signature: 'sig' };
const resolved = { backendId: 'b', backendKind: 'local', trust: 'restricted', entry, version, source: 's' };

describe('registry schemas refuse empty identity/integrity strings, one field at a time', () => {
  const cases: Array<[string, ZodTypeAny, Record<string, unknown>, string]> = [
    ['dist', RegistryDistSchema, {}, 'archive'],
    ['dist', RegistryDistSchema, {}, 'integrity'],
    ['dist', RegistryDistSchema, {}, 'manifestDigest'],
    ['publisher', RegistryPublisherSchema, {}, 'id'],
    ['publisher', RegistryPublisherSchema, {}, 'name'],
    ['publisher', RegistryPublisherSchema, {}, 'github'],
    ['publisher', RegistryPublisherSchema, {}, 'url'],
    ['signature', RegistrySignatureSchema, signature, 'issuer'],
    ['signature', RegistrySignatureSchema, signature, 'subject'],
    ['signature', RegistrySignatureSchema, signature, 'signature'],
    ['signature', RegistrySignatureSchema, signature, 'certificate'],
    ['version', RegistryVersionSchema, version, 'version'],
    ['version', RegistryVersionSchema, version, 'source'],
    ['version', RegistryVersionSchema, version, 'ref'],
    ['version', RegistryVersionSchema, version, 'integrity'],
    ['version', RegistryVersionSchema, version, 'manifestDigest'],
    ['entry', RegistryEntrySchema, entry, 'version'],
    ['entry', RegistryEntrySchema, entry, 'source'],
    ['entry', RegistryEntrySchema, entry, 'ref'],
    ['entry', RegistryEntrySchema, entry, 'integrity'],
    ['entry', RegistryEntrySchema, entry, 'manifestDigest'],
    ['manifest', RegistryManifestSchema, { specVersion: '1', name: 'n', version: '1', entries: [] }, 'specVersion'],
    ['manifest', RegistryManifestSchema, { specVersion: '1', name: 'n', version: '1', entries: [] }, 'name'],
    ['manifest', RegistryManifestSchema, { specVersion: '1', name: 'n', version: '1', entries: [] }, 'version'],
    ['resolved', ResolvedRegistryEntrySchema, resolved, 'backendId'],
    ['resolved', ResolvedRegistryEntrySchema, resolved, 'source'],
    ['yank', RegistryYankOutcomeSchema, { ok: true, name: 'n', version: '1', reason: 'r' }, 'name'],
    ['yank', RegistryYankOutcomeSchema, { ok: true, name: 'n', version: '1', reason: 'r' }, 'version'],
    ['yank', RegistryYankOutcomeSchema, { ok: true, name: 'n', version: '1', reason: 'r' }, 'reason'],
    ['doctor issue', RegistryDoctorIssueSchema, { severity: 'info', code: 'c', message: 'm' }, 'code'],
    ['doctor issue', RegistryDoctorIssueSchema, { severity: 'info', code: 'c', message: 'm' }, 'message'],
  ];

  it.each(cases)('%s.%s: one char accepted, empty refused at that path', (_schema, schema, base, field) => {
    expect(schema.safeParse({ ...base, [field]: 'x' }).success).toBe(true);
    expect(issuePaths(schema, { ...base, [field]: '' })).toEqual([field]);
  });

  it('nested dist/publisher/signature/version issues report their nested path', () => {
    expect(issuePaths(RegistryEntrySchema, { ...entry, dist: { archive: '' } })).toEqual(['dist.archive']);
    expect(issuePaths(RegistryEntrySchema, { ...entry, publisher: { github: '' } })).toEqual(['publisher.github']);
    expect(issuePaths(RegistryEntrySchema, { ...entry, signatures: [signature, { ...signature, signature: '' }] })).toEqual(['signatures.1.signature']);
    expect(issuePaths(RegistryEntrySchema, { ...entry, versions: [version, { version: '' }] })).toEqual(['versions.1.version']);
    expect(issuePaths(RegistryVersionSchema, { ...version, dist: { integrity: '' } })).toEqual(['dist.integrity']);
    expect(issuePaths(RegistryManifestSchema, { specVersion: '1', name: 'n', version: '1', entries: [entry, { ...entry, name: 'bad' }] })).toEqual(['entries.1.name']);
  });

  it.each([
    ['dist.type', RegistryDistSchema, {}, 'type', ['github-release', 'https-archive', 'local-archive', 'database'], 'npm'],
    ['signature.kind', RegistrySignatureSchema, signature, 'kind', ['github-oidc', 'cosign', 'minisign', 'custom'], 'gpg'],
    ['resolved.backendKind', ResolvedRegistryEntrySchema, resolved, 'backendKind', ['github', 'http', 'local', 'db'], 'ftp'],
    ['resolved.trust', ResolvedRegistryEntrySchema, resolved, 'trust', ['official', 'trusted', 'restricted'], 'root'],
    ['doctor.severity', RegistryDoctorIssueSchema, { code: 'c', message: 'm' }, 'severity', ['error', 'warning', 'info'], 'fatal'],
  ] as Array<[string, ZodTypeAny, Record<string, unknown>, string, string[], string]>)('%s enum: every member accepted, outsider and case variant refused', (_label, schema, base, field, members, outsider) => {
    for (const member of members) expect(schema.safeParse({ ...base, [field]: member }).success).toBe(true);
    expect(issuePaths(schema, { ...base, [field]: outsider })).toEqual([field]);
    expect(issuePaths(schema, { ...base, [field]: members[0]!.toUpperCase() })).toEqual([field]);
  });
});

describe('registry entry name grammar', () => {
  it.each(['a/b', 'vendor/example', '0v/9p', 'v.e-n_d/p.l-u_g', 'a/b-'])('accepts %j', (name) => {
    expect(RegistryEntrySchema.safeParse({ ...entry, name }).success).toBe(true);
  });
  it.each(['', 'example', '/b', 'a/', '-a/b', 'a/-b', '.a/b', 'A/b', 'a/B', 'a/b/c', 'a//b', ' a/b', 'a/b ', 'a/b\n', 'x a/b', 'a/b!', 'evil:a/b'])('refuses %j', (name) => {
    expect(issuePaths(RegistryEntrySchema, { ...entry, name })).toEqual(['name']);
  });
});

describe('registry numeric bounds', () => {
  it.each(['downloads', 'installs', 'stars'])('metrics.%s: 0 accepted; -1 and 1.5 refused', (field) => {
    expect(RegistryMetricsSchema.safeParse({ [field]: 0 }).success).toBe(true);
    expect(issuePaths(RegistryMetricsSchema, { [field]: -1 })).toEqual([field]);
    expect(issuePaths(RegistryMetricsSchema, { [field]: 1.5 })).toEqual([field]);
  });

  it('search limit is a positive int up to 500, and query defaults to empty', () => {
    expect(RegistrySearchQuerySchema.parse({})).toEqual({ query: '' });
    for (const limit of [1, 500]) expect(RegistrySearchQuerySchema.safeParse({ limit }).success).toBe(true);
    for (const limit of [0, 501, 2.5, -1]) expect(issuePaths(RegistrySearchQuerySchema, { limit })).toEqual(['limit']);
  });

  it('search result score is non-negative; doctor entriesChecked is a non-negative int', () => {
    expect(RegistrySearchResultSchema.safeParse({ entry, score: 0, matched: [] }).success).toBe(true);
    expect(issuePaths(RegistrySearchResultSchema, { entry, score: -0.1, matched: [] })).toEqual(['score']);
    const report = { ok: true, backendId: 'b', checkedAt: 1, entriesChecked: 0, issues: [] };
    expect(RegistryDoctorReportSchema.safeParse(report).success).toBe(true);
    expect(issuePaths(RegistryDoctorReportSchema, { ...report, entriesChecked: -1 })).toEqual(['entriesChecked']);
    expect(issuePaths(RegistryDoctorReportSchema, { ...report, backendId: '' })).toEqual(['backendId']);
  });
});

describe('resolved entry verification metadata', () => {
  it('defaults verified to false', () => {
    expect(ResolvedRegistryEntrySchema.parse(resolved).verified).toBe(false);
  });
  it.each(['verifiedIssuer', 'verifiedSubject'])('refuses %s without verified:true, with that exact path and message', (field) => {
    for (const verified of [false, undefined]) {
      const result = ResolvedRegistryEntrySchema.safeParse({ ...resolved, verified, [field]: 'x' });
      expect(result.success).toBe(false);
      if (result.success) continue;
      expect(result.error.issues).toEqual([expect.objectContaining({ code: 'custom', path: [field], message: 'Verification metadata requires verified: true' })]);
    }
    expect(ResolvedRegistryEntrySchema.safeParse({ ...resolved, verified: true, [field]: 'x' }).success).toBe(true);
  });
  it('reports both fields when both are present unverified', () => {
    expect(issuePaths(ResolvedRegistryEntrySchema, { ...resolved, verifiedIssuer: 'i', verifiedSubject: 's' })).toEqual(['verifiedIssuer', 'verifiedSubject']);
  });
});

describe('registry optional shapes still validate their fields', () => {
  it.each([[RegistryEntrySchema, entry], [RegistryVersionSchema, version]] as Array<[ZodTypeAny, Record<string, unknown>]>)('deprecated accepts boolean or message, nothing else', (schema, base) => {
    for (const deprecated of [true, false, 'use v2']) expect(schema.parse({ ...base, deprecated }).deprecated).toBe(deprecated);
    expect(issuePaths(schema, { ...base, deprecated: 1 })).toEqual(['deprecated']);
  });
  it('list filter is optional but its fields are typed', () => {
    expect(RegistryListFilterSchema.parse(undefined)).toBeUndefined();
    expect(RegistryListFilterSchema.parse({ query: 'q', tags: ['a'], publisher: 'p', includeYanked: true })).toEqual({ query: 'q', tags: ['a'], publisher: 'p', includeYanked: true });
    expect(issuePaths(RegistryListFilterSchema, { query: 5 })).toEqual(['query']);
    expect(issuePaths(RegistryListFilterSchema, { includeYanked: 'yes' })).toEqual(['includeYanked']);
  });
  it('publish request requires a valid entry and types its options', () => {
    expect(issuePaths(RegistryPublishRequestSchema, {})).toEqual(['entry']);
    expect(issuePaths(RegistryPublishRequestSchema, { entry, dryRun: 'no' })).toEqual(['dryRun']);
    expect(RegistryPublishRequestSchema.parse({ entry, tag: 'next' })).toEqual({ entry, tag: 'next' });
  });
  it('publish outcome defaults changedFiles and warnings to EMPTY arrays', () => {
    expect(RegistryPublishOutcomeSchema.parse({ ok: true })).toEqual({ ok: true, changedFiles: [], warnings: [] });
  });
});
