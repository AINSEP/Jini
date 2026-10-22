import { describe, expect, it } from 'vitest';
import {
  emptyArtifactManifestTaxonomy,
  noopManifestInferrer,
  parsePersistedManifest,
  sanitizeManifest,
  validateArtifactManifestInput,
  type ArtifactManifestTaxonomy,
} from '../manifest.js';

const taxonomy: ArtifactManifestTaxonomy = {
  allowedKinds: new Set(['html', 'markdown']),
  allowedRenderers: new Set(['html', 'markdown']),
  allowedExports: new Set(['html', 'pdf', 'md']),
};

const validManifest = {
  kind: 'html',
  renderer: 'html',
  exports: ['html'],
};

describe('validateArtifactManifestInput', () => {
  it('accepts null/undefined manifest as "no manifest supplied"', () => {
    expect(validateArtifactManifestInput({ manifest: null, entry: 'index.html', taxonomy: taxonomy })).toEqual({ ok: true, value: null });
    expect(validateArtifactManifestInput({ manifest: undefined, entry: 'index.html', taxonomy: taxonomy })).toEqual({ ok: true, value: null });
  });

  it('rejects a non-object manifest', () => {
    expect(validateArtifactManifestInput({ manifest: 'nope', entry: 'x', taxonomy: taxonomy })).toEqual({
      ok: false,
      error: 'artifactManifest must be an object',
    });
    expect(validateArtifactManifestInput({ manifest: [1, 2], entry: 'x', taxonomy: taxonomy })).toEqual({
      ok: false,
      error: 'artifactManifest must be an object',
    });
  });

  it('accepts a null-prototype object (e.g. Object.create(null)) as a plain object', () => {
    const nullProto = Object.create(null) as Record<string, unknown>;
    Object.assign(nullProto, validManifest);
    const result = validateArtifactManifestInput({ manifest: nullProto, entry: 'x', taxonomy: taxonomy });
    expect(result.ok).toBe(true);
  });

  it('validates kind: required, bounded, and taxonomy-membership', () => {
    expect(validateArtifactManifestInput({ manifest: { ...validManifest, kind: undefined }, entry: 'x', taxonomy: taxonomy })).toEqual({
      ok: false,
      error: 'artifactManifest.kind must be a string',
    });
    expect(validateArtifactManifestInput({ manifest: { ...validManifest, kind: 42 }, entry: 'x', taxonomy: taxonomy })).toEqual({
      ok: false,
      error: 'artifactManifest.kind must be a string',
    });
    expect(validateArtifactManifestInput({ manifest: { ...validManifest, kind: 'x'.repeat(65) }, entry: 'x', taxonomy: taxonomy })).toEqual({
      ok: false,
      error: 'artifactManifest.kind exceeds max length (64)',
    });
    expect(validateArtifactManifestInput({ manifest: { ...validManifest, kind: 'not-allowed' }, entry: 'x', taxonomy: taxonomy })).toEqual({
      ok: false,
      error: 'artifactManifest.kind is not allowed',
    });
  });

  it('validates renderer: required, bounded, and taxonomy-membership', () => {
    expect(validateArtifactManifestInput({ manifest: { ...validManifest, renderer: '' }, entry: 'x', taxonomy: taxonomy })).toEqual({
      ok: false,
      error: 'artifactManifest.renderer is required',
    });
    expect(validateArtifactManifestInput({ manifest: { ...validManifest, renderer: 'not-allowed' }, entry: 'x', taxonomy: taxonomy })).toEqual({
      ok: false,
      error: 'artifactManifest.renderer is not allowed',
    });
  });

  it('validates exports: non-empty array of taxonomy-allowed strings', () => {
    expect(validateArtifactManifestInput({ manifest: { ...validManifest, exports: [] }, entry: 'x', taxonomy: taxonomy })).toEqual({
      ok: false,
      error: 'artifactManifest.exports must be a non-empty array',
    });
    expect(validateArtifactManifestInput({ manifest: { ...validManifest, exports: 'html' }, entry: 'x', taxonomy: taxonomy })).toEqual({
      ok: false,
      error: 'artifactManifest.exports must be a non-empty array',
    });
    expect(validateArtifactManifestInput({ manifest: { ...validManifest, exports: [42] }, entry: 'x', taxonomy: taxonomy })).toEqual({
      ok: false,
      error: 'artifactManifest.exports must contain strings',
    });
    expect(validateArtifactManifestInput({ manifest: { ...validManifest, exports: ['zip'] }, entry: 'x', taxonomy: taxonomy })).toEqual({
      ok: false,
      error: 'artifactManifest.exports contains unsupported value: zip',
    });
  });

  it('validates status: optional, must be a known string when present', () => {
    const ok = validateArtifactManifestInput({ manifest: { ...validManifest, status: 'streaming' }, entry: 'x', taxonomy: taxonomy });
    expect(ok.ok && ok.value?.status).toBe('streaming');
    expect(validateArtifactManifestInput({ manifest: { ...validManifest, status: 42 }, entry: 'x', taxonomy: taxonomy })).toEqual({
      ok: false,
      error: 'artifactManifest.status must be a string',
    });
    expect(validateArtifactManifestInput({ manifest: { ...validManifest, status: 'bogus' }, entry: 'x', taxonomy: taxonomy })).toEqual({
      ok: false,
      error: 'artifactManifest.status is not allowed',
    });
  });

  it('defaults status to complete when omitted', () => {
    const result = validateArtifactManifestInput({ manifest: validManifest, entry: 'x', taxonomy: taxonomy });
    expect(result.ok && result.value?.status).toBe('complete');
  });

  it('validates primary: true, or a safe relative path', () => {
    const trueCase = validateArtifactManifestInput({ manifest: { ...validManifest, primary: true }, entry: 'x', taxonomy: taxonomy });
    expect(trueCase.ok && trueCase.value?.primary).toBe(true);

    const pathCase = validateArtifactManifestInput({ manifest: { ...validManifest, primary: 'a\\b.html' }, entry: 'x', taxonomy: taxonomy });
    expect(pathCase.ok && pathCase.value?.primary).toBe('a/b.html');

    expect(validateArtifactManifestInput({ manifest: { ...validManifest, primary: '/abs/path' }, entry: 'x', taxonomy: taxonomy })).toEqual({
      ok: false,
      error: 'artifactManifest.primary supportingFiles cannot contain absolute paths',
    });
  });

  it('validates supportingFiles: array of safe relative paths, bounded count', () => {
    const ok = validateArtifactManifestInput({ manifest: { ...validManifest, supportingFiles: ['a.css', 'b\\c.js'] }, entry: 'x', taxonomy: taxonomy });
    expect(ok.ok && ok.value?.supportingFiles).toEqual(['a.css', 'b/c.js']);

    expect(validateArtifactManifestInput({ manifest: { ...validManifest, supportingFiles: 'a.css' }, entry: 'x', taxonomy: taxonomy })).toEqual({
      ok: false,
      error: 'artifactManifest.supportingFiles must be an array',
    });
    expect(
      validateArtifactManifestInput({ manifest: { ...validManifest, supportingFiles: Array.from({ length: 129 }, (_, i) => `f${i}.css`) }, entry: 'x', taxonomy: taxonomy }),
    ).toEqual({ ok: false, error: 'artifactManifest.supportingFiles exceeds max items (128)' });
    expect(validateArtifactManifestInput({ manifest: { ...validManifest, supportingFiles: ['../x'] }, entry: 'x', taxonomy: taxonomy })).toEqual({
      ok: false,
      error: 'supportingFiles cannot contain traversal segments',
    });
  });

  it('rejects supportingFiles entries: non-string, empty, too long, drive-letter, traversal, null-byte', () => {
    const cases: Array<[unknown, string]> = [
      [42, 'supportingFiles entries must be strings'],
      ['', 'supportingFiles entries cannot be empty'],
      ['x'.repeat(261), 'supportingFiles entries exceed max length (260)'],
      ['C:\\windows', 'supportingFiles cannot contain absolute paths'],
      ['a\u0000b', 'supportingFiles cannot contain null bytes'],
      ['./', 'supportingFiles cannot contain traversal segments'],
    ];
    for (const [entry, message] of cases) {
      expect(validateArtifactManifestInput({ manifest: { ...validManifest, supportingFiles: [entry] }, entry: 'x', taxonomy: taxonomy })).toEqual({
        ok: false,
        error: message,
      });
    }
  });

  it('validates title: optional, bounded, non-empty when present', () => {
    expect(validateArtifactManifestInput({ manifest: { ...validManifest, title: '' }, entry: 'x', taxonomy: taxonomy })).toEqual({
      ok: false,
      error: 'artifactManifest.title is required',
    });
    expect(validateArtifactManifestInput({ manifest: { ...validManifest, title: 'x'.repeat(201) }, entry: 'x', taxonomy: taxonomy })).toEqual({
      ok: false,
      error: 'artifactManifest.title exceeds max length (200)',
    });
    const ok = validateArtifactManifestInput({ manifest: { ...validManifest, title: 'My Title' }, entry: 'x', taxonomy: taxonomy });
    expect(ok.ok && ok.value?.title).toBe('My Title');
  });

  it('falls back to entry as the title when omitted', () => {
    const result = validateArtifactManifestInput({ manifest: validManifest, entry: 'index.html', taxonomy: taxonomy });
    expect(result.ok && result.value?.title).toBe('index.html');
  });

  it('validates sourceContextId: optional, bounded, allowed empty', () => {
    const ok = validateArtifactManifestInput({ manifest: { ...validManifest, sourceContextId: '' }, entry: 'x', taxonomy: taxonomy });
    expect(ok.ok).toBe(true);
    expect(validateArtifactManifestInput({ manifest: { ...validManifest, sourceContextId: 'x'.repeat(129) }, entry: 'x', taxonomy: taxonomy })).toEqual({
      ok: false,
      error: 'artifactManifest.sourceContextId exceeds max length (128)',
    });
  });

  it('validates metadata: must be a plain object, JSON-serializable, size-capped', () => {
    expect(validateArtifactManifestInput({ manifest: { ...validManifest, metadata: 'x' }, entry: 'x', taxonomy: taxonomy })).toEqual({
      ok: false,
      error: 'artifactManifest.metadata must be a plain object',
    });
    const big = { blob: 'x'.repeat(20 * 1024) };
    expect(validateArtifactManifestInput({ manifest: { ...validManifest, metadata: big }, entry: 'x', taxonomy: taxonomy })).toEqual({
      ok: false,
      error: 'artifactManifest.metadata exceeds max size (16384 bytes)',
    });
    const ok = validateArtifactManifestInput({ manifest: { ...validManifest, metadata: { a: 1 } }, entry: 'x', taxonomy: taxonomy });
    expect(ok.ok && ok.value?.metadata).toEqual({ a: 1 });
  });

  it('prefers a manifest-supplied entry over the caller-supplied fallback, trimmed', () => {
    const result = validateArtifactManifestInput({ manifest: { ...validManifest, entry: '  custom.html  ' }, entry: 'fallback.html', taxonomy: taxonomy });
    expect(result.ok && result.value?.entry).toBe('custom.html');
  });

  it('falls back to the caller-supplied entry when the manifest omits/blanks it', () => {
    const blank = validateArtifactManifestInput({ manifest: { ...validManifest, entry: '   ' }, entry: 'fallback.html', taxonomy: taxonomy });
    expect(blank.ok && blank.value?.entry).toBe('fallback.html');
  });

  it('rejects an unsafe entry and an entry exceeding the max length', () => {
    expect(validateArtifactManifestInput({ manifest: validManifest, entry: '../escape.html', taxonomy: taxonomy })).toEqual({
      ok: false,
      error: 'artifactManifest.entry supportingFiles cannot contain traversal segments',
    });
    expect(validateArtifactManifestInput({ manifest: validManifest, entry: 'x'.repeat(261) + '.html', taxonomy: taxonomy })).toEqual({
      ok: false,
      error: 'artifactManifest.entry supportingFiles entries exceed max length (260)',
    });
  });

  it('preserves updatedAt when preserveUpdatedAt is set and the manifest already has one', () => {
    const result = validateArtifactManifestInput({ manifest: { ...validManifest, updatedAt: '2020-01-01T00:00:00.000Z' }, entry: 'x', taxonomy: taxonomy }, { preserveUpdatedAt: true });
    expect(result.ok && result.value?.updatedAt).toBe('2020-01-01T00:00:00.000Z');
  });

  it('stamps a fresh updatedAt when preserveUpdatedAt is not set, even if the manifest has one', () => {
    const before = Date.now();
    const result = validateArtifactManifestInput({ manifest: { ...validManifest, updatedAt: '2020-01-01T00:00:00.000Z' }, entry: 'x', taxonomy: taxonomy });
    expect(result.ok && result.value ? new Date(result.value.updatedAt).getTime() : 0).toBeGreaterThanOrEqual(before);
  });

  it('preserves an existing createdAt', () => {
    const result = validateArtifactManifestInput({ manifest: { ...validManifest, createdAt: '2020-01-01T00:00:00.000Z' }, entry: 'x', taxonomy: taxonomy });
    expect(result.ok && result.value?.createdAt).toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('sanitizeManifest', () => {
  it('can be called directly against a raw record', () => {
    const result = sanitizeManifest({ manifest: { kind: 'html', renderer: 'html', exports: ['html'] }, entry: 'index.html' });
    expect(result.kind).toBe('html');
    expect(result.entry).toBe('index.html');
    expect(result.version).toBe(1);
  });

  it('omits optional fields entirely when absent rather than setting them to undefined', () => {
    const result = validateArtifactManifestInput({ manifest: validManifest, entry: 'x', taxonomy: taxonomy });
    expect(result.ok).toBe(true);
    if (result.ok && result.value) {
      expect('primary' in result.value).toBe(false);
      expect('supportingFiles' in result.value).toBe(false);
      expect('sourceContextId' in result.value).toBe(false);
      expect('metadata' in result.value).toBe(false);
    }
  });
});

describe('parsePersistedManifest', () => {
  it('round-trips a manifest produced by validateArtifactManifestInput', () => {
    const result = validateArtifactManifestInput({ manifest: validManifest, entry: 'index.html', taxonomy: taxonomy });
    expect(result.ok).toBe(true);
    const raw = JSON.stringify(result.ok ? result.value : null);
    const parsed = parsePersistedManifest({ raw, fallbackEntry: 'index.html', taxonomy });
    expect(parsed?.kind).toBe('html');
    expect(parsed?.entry).toBe('index.html');
  });

  it('returns null on malformed JSON', () => {
    expect(parsePersistedManifest({ raw: 'not json {{', fallbackEntry: 'x', taxonomy })).toBeNull();
  });

  it('returns null on a version mismatch or non-object payload', () => {
    expect(parsePersistedManifest({ raw: JSON.stringify({ version: 999 }), fallbackEntry: 'x', taxonomy })).toBeNull();
    expect(parsePersistedManifest({ raw: JSON.stringify('a string'), fallbackEntry: 'x', taxonomy })).toBeNull();
  });

  it('returns null when the persisted manifest fails re-validation', () => {
    const raw = JSON.stringify({ version: 1, kind: 'not-allowed', renderer: 'html', exports: ['html'], entry: 'x' });
    expect(parsePersistedManifest({ raw, fallbackEntry: 'x', taxonomy })).toBeNull();
  });

  it('falls back to fallbackEntry when the persisted payload has no entry field', () => {
    const raw = JSON.stringify({ version: 1, kind: 'html', renderer: 'html', exports: ['html'] });
    const parsed = parsePersistedManifest({ raw, fallbackEntry: 'fallback.html', taxonomy });
    expect(parsed?.entry).toBe('fallback.html');
  });
});

describe('emptyArtifactManifestTaxonomy / noopManifestInferrer', () => {
  it('the empty taxonomy accepts nothing', () => {
    const result = validateArtifactManifestInput({ manifest: validManifest, entry: 'x', taxonomy: emptyArtifactManifestTaxonomy });
    expect(result).toEqual({ ok: false, error: 'artifactManifest.kind is not allowed' });
  });

  it('the noop inferrer always returns null', () => {
    expect(noopManifestInferrer({ entry: 'index.html' })).toBeNull();
  });
});
