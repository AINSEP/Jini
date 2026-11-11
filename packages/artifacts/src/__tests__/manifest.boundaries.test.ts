/**
 * @file Boundaries of artifact manifest validation, each pinned by its exact error: the plain-object
 * guard (arrays, class instances, Map, Date, null-proto), title / supporting-path length at N and
 * N+1, the drive-letter rule only at the start, and `..` anywhere in a path segment. Closes L10
 * Stryker survivors at manifest.ts:81, 83, 94, 101, 105, 109.
 */
import { describe, expect, test } from 'vitest';
import { parsePersistedManifest, validateArtifactManifestInput, type ArtifactManifestTaxonomy } from '../manifest.js';

const taxonomy: ArtifactManifestTaxonomy = { allowedKinds: new Set(['html']), allowedRenderers: new Set(['html']), allowedExports: new Set(['html']) };
const base = { kind: 'html', renderer: 'html', exports: ['html'] };
const validate = (manifest: unknown, entry: unknown = 'index.html') => validateArtifactManifestInput({ manifest, entry, taxonomy }, { now: () => 'T' });
const error = (manifest: unknown, entry?: unknown) => { const r = validate(manifest, entry); return r.ok ? null : r.error; };

describe('plain-object guard', () => {
  class Box { kind = 'html'; renderer = 'html'; exports = ['html']; }
  test.each<[string, unknown]>([['array', [base]], ['class instance', new Box()], ['Map', new Map()], ['Date', new Date(0)], ['number', 1], ['string', 'x'], ['true', true]])(
    'a %s manifest is not an object', (_name, manifest) => { expect(error(manifest)).toBe('artifactManifest must be an object'); },
  );
  test.each<[string, unknown]>([['array', []], ['class instance', new Box()], ['null', null], ['string', 'x']])(
    'metadata as %s is refused', (_name, metadata) => { expect(error({ ...base, metadata })).toBe('artifactManifest.metadata must be a plain object'); },
  );
  test('a null-prototype manifest and metadata are plain objects', () => {
    const manifest = Object.assign(Object.create(null) as object, base, { metadata: Object.assign(Object.create(null) as object, { a: 1 }) });
    expect(validate(manifest).ok).toBe(true);
  });
});

describe('length limits at N and N+1', () => {
  test('title: 200 ok, 201 refused, empty refused', () => {
    expect(error({ ...base, title: 't'.repeat(200) })).toBeNull();
    expect(error({ ...base, title: 't'.repeat(201) })).toBe('artifactManifest.title exceeds max length (200)');
    expect(error({ ...base, title: '' })).toBe('artifactManifest.title is required');
  });
  test('sourceContextId: 128 ok, 129 refused, empty allowed', () => {
    expect(error({ ...base, sourceContextId: 's'.repeat(128) })).toBeNull();
    expect(error({ ...base, sourceContextId: 's'.repeat(129) })).toBe('artifactManifest.sourceContextId exceeds max length (128)');
    expect(error({ ...base, sourceContextId: '' })).toBeNull();
  });
  test('supporting file path: 260 ok, 261 refused', () => {
    expect(error({ ...base, supportingFiles: ['a'.repeat(260)] })).toBeNull();
    expect(error({ ...base, supportingFiles: ['a'.repeat(261)] })).toBe('supportingFiles entries exceed max length (260)');
  });
  test('supporting files: 128 ok, 129 refused', () => {
    expect(error({ ...base, supportingFiles: Array.from({ length: 128 }, (_, i) => `f${i}.css`) })).toBeNull();
    expect(error({ ...base, supportingFiles: Array.from({ length: 129 }, (_, i) => `f${i}.css`) })).toBe('artifactManifest.supportingFiles exceeds max items (128)');
  });
});

describe('supporting paths', () => {
  test.each([['C:x.css'], ['c:/x.css'], ['/abs.css'], ['\\abs.css']])('%j is absolute', (rel) => {
    expect(error({ ...base, supportingFiles: [rel] })).toBe('supportingFiles cannot contain absolute paths');
  });
  test.each([['../x.css'], ['a/../x.css'], ['a..b.css'], ['a\\..\\x.css'], ['./x.css'], ['a/./x.css']])('%j is refused as traversal', (rel) => {
    expect(error({ ...base, supportingFiles: [rel] })).toBe('supportingFiles cannot contain traversal segments');
  });
  test.each([['assets/C:x.css'], ['a/b.css'], ['a\\b.css']])('%j is a legal relative path', (rel) => {
    expect(error({ ...base, supportingFiles: [rel] })).toBeNull();
  });
  test('NUL, empty and non-string entries each get their own error', () => {
    expect(error({ ...base, supportingFiles: ['a\u0000.css'] })).toBe('supportingFiles cannot contain null bytes');
    expect(error({ ...base, supportingFiles: [''] })).toBe('supportingFiles entries cannot be empty');
    expect(error({ ...base, supportingFiles: [7] })).toBe('supportingFiles entries must be strings');
  });
});

// F5 re-score survivors (manifest.ts:231, 345-347): persisted-manifest version/entry rules and the
// exact metadata size limit.
describe('parsePersistedManifest', () => {
  const persisted = (patch: Record<string, unknown>) => JSON.stringify({ version: 1, ...base, createdAt: 'C', updatedAt: 'U', ...patch });
  const parse = (raw: string) => parsePersistedManifest({ raw, fallbackEntry: 'fallback.html', taxonomy });

  test('its own entry wins; a missing, empty or non-string entry falls back', () => {
    expect(parse(persisted({ entry: 'own.html' }))?.entry).toBe('own.html');
    for (const entry of [undefined, '', 7]) expect(parse(persisted({ entry }))?.entry).toBe('fallback.html');
  });

  test('the original updatedAt is preserved', () => {
    expect(parse(persisted({ entry: 'own.html' }))).toMatchObject({ createdAt: 'C', updatedAt: 'U' });
  });

  test.each([['wrong version', persisted({ version: 2 })], ['no version', JSON.stringify(base)], ['an array', '[]'], ['null', 'null'], ['not JSON', '{']])('%s is null', (_name, raw) => {
    expect(parse(raw)).toBeNull();
  });
});

test('metadata of exactly 16 KiB of JSON is accepted; one byte more is refused', () => {
  const metadata = (length: number) => ({ k: 'x'.repeat(length) });
  const overhead = JSON.stringify(metadata(0)).length;
  expect(error({ ...base, metadata: metadata(16 * 1024 - overhead) })).toBeNull();
  expect(error({ ...base, metadata: metadata(16 * 1024 - overhead + 1) })).toBe('artifactManifest.metadata exceeds max size (16384 bytes)');
});
