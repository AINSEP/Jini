import { describe, expect, it } from 'vitest';
import { sanitizeManifest, validateArtifactManifestInput } from '../manifest.js';

const taxonomy = {
  allowedKinds: new Set(['document']),
  allowedRenderers: new Set(['html']),
  allowedExports: new Set(['html']),
};
const manifest = { kind: 'document', renderer: 'html', exports: ['html'] };
const now = () => 'clock';

describe('manifest validation characterization', () => {
  it.each([null, undefined])('accepts no manifest: %s', (value) => {
    expect(validateArtifactManifestInput({ manifest: value, entry: '../unsafe', taxonomy })).toEqual({ ok: true, value: null });
  });

  it.each([[], 'text', 1, new Date()])('rejects a non-record manifest: %s', (value) => {
    expect(validateArtifactManifestInput({ manifest: value, entry: 'index.html', taxonomy })).toEqual({ ok: false, error: 'artifactManifest must be an object' });
  });

  it.each<{ patch: Record<string, unknown>; error: string }>([
    { patch: { kind: 1 }, error: 'artifactManifest.kind must be a string' },
    { patch: { kind: '' }, error: 'artifactManifest.kind is required' },
    { patch: { kind: 'x'.repeat(65) }, error: 'artifactManifest.kind exceeds max length (64)' },
    { patch: { kind: 'other' }, error: 'artifactManifest.kind is not allowed' },
    { patch: { renderer: 1 }, error: 'artifactManifest.renderer must be a string' },
    { patch: { renderer: '' }, error: 'artifactManifest.renderer is required' },
    { patch: { renderer: 'x'.repeat(65) }, error: 'artifactManifest.renderer exceeds max length (64)' },
    { patch: { renderer: 'other' }, error: 'artifactManifest.renderer is not allowed' },
    { patch: { exports: null }, error: 'artifactManifest.exports must be a non-empty array' },
    { patch: { exports: [] }, error: 'artifactManifest.exports must be a non-empty array' },
    { patch: { exports: [1] }, error: 'artifactManifest.exports must contain strings' },
    { patch: { exports: ['other'] }, error: 'artifactManifest.exports contains unsupported value: other' },
    { patch: { status: 1 }, error: 'artifactManifest.status must be a string' },
    { patch: { status: 'other' }, error: 'artifactManifest.status is not allowed' },
    { patch: { primary: false }, error: 'artifactManifest.primary supportingFiles entries must be strings' },
    { patch: { primary: '../escape' }, error: 'artifactManifest.primary supportingFiles cannot contain traversal segments' },
    { patch: { supportingFiles: 'file' }, error: 'artifactManifest.supportingFiles must be an array' },
    { patch: { supportingFiles: Array(129).fill('file') }, error: 'artifactManifest.supportingFiles exceeds max items (128)' },
    { patch: { supportingFiles: ['../escape'] }, error: 'supportingFiles cannot contain traversal segments' },
    { patch: { title: 1 }, error: 'artifactManifest.title must be a string' },
    { patch: { title: '' }, error: 'artifactManifest.title is required' },
    { patch: { title: 'x'.repeat(201) }, error: 'artifactManifest.title exceeds max length (200)' },
    { patch: { sourceContextId: 1 }, error: 'artifactManifest.sourceContextId must be a string' },
    { patch: { sourceContextId: 'x'.repeat(129) }, error: 'artifactManifest.sourceContextId exceeds max length (128)' },
    { patch: { metadata: [] }, error: 'artifactManifest.metadata must be a plain object' },
    { patch: { metadata: { text: 'é'.repeat(8192) } }, error: 'artifactManifest.metadata exceeds max size (16384 bytes)' },
    { patch: { entry: '../escape' }, error: 'artifactManifest.entry supportingFiles cannot contain traversal segments' },
  ])('preserves the error for $patch', ({ patch, error }) => {
    expect(validateArtifactManifestInput({ manifest: { ...manifest, ...patch }, entry: 'index.html', taxonomy })).toEqual({ ok: false, error });
  });

  it('preserves validation order before metadata serialization and entry checks', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(validateArtifactManifestInput({ manifest: { ...manifest, status: 'invalid', metadata: circular }, entry: '../escape', taxonomy })).toEqual({ ok: false, error: 'artifactManifest.status is not allowed' });
  });

  it('throws for circular metadata (reported, not fixed)', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => validateArtifactManifestInput({ manifest: { ...manifest, metadata: circular }, entry: 'index.html', taxonomy })).toThrow(TypeError);
  });

  it('accepts a backslash absolute path after normalization (reported, not fixed)', () => {
    const result = validateArtifactManifestInput({ manifest, entry: '\\root\\file.html', taxonomy }, { now });
    expect(result).toEqual({ ok: true, value: { version: 1, ...manifest, title: '/root/file.html', entry: '/root/file.html', status: 'complete', createdAt: 'clock', updatedAt: 'clock' } });
  });

  it.each(['streaming', 'complete', 'error'])('retains valid status %s and all optional fields', (status) => {
    const metadata = { note: 'kept' };
    expect(validateArtifactManifestInput({ manifest: { ...manifest, title: 'Title', entry: '  dir\\index.html  ', status, primary: 'dir\\main.html', supportingFiles: ['dir\\extra.html'], sourceContextId: '', metadata, createdAt: 'created', updatedAt: 'updated' }, entry: '../ignored', taxonomy }, { now, preserveUpdatedAt: true })).toEqual({ ok: true, value: { version: 1, ...manifest, title: 'Title', entry: 'dir/index.html', status, primary: 'dir/main.html', supportingFiles: ['dir/extra.html'], sourceContextId: '', metadata, createdAt: 'created', updatedAt: 'updated' } });
  });

  it.each([undefined, '', '  ', 42])('falls back to the caller entry for %s', (entry) => {
    expect(validateArtifactManifestInput({ manifest: { ...manifest, entry, primary: true, supportingFiles: [] }, entry: 'fallback.html', taxonomy }, { now })).toEqual({ ok: true, value: { version: 1, ...manifest, title: 'fallback.html', entry: 'fallback.html', status: 'complete', primary: true, supportingFiles: [], createdAt: 'clock', updatedAt: 'clock' } });
  });
});

describe('direct manifest sanitization characterization', () => {
  it.each([undefined, 42, 'invalid'])('defaults an invalid status and timestamp types: %s', (status) => {
    expect(sanitizeManifest({ manifest: { ...manifest, status, title: '', primary: false, supportingFiles: false, createdAt: 42, updatedAt: 42 }, entry: 'file' }, { now, preserveUpdatedAt: true })).toEqual({ version: 1, ...manifest, title: 'file', entry: 'file', status: 'complete', createdAt: 'clock', updatedAt: 'clock' });
  });

  it('coerces supporting entries, preserves true primary, and stamps updatedAt by default', () => {
    expect(sanitizeManifest({ manifest: { ...manifest, primary: true, supportingFiles: [42, 'a\\b'], updatedAt: 'old' }, entry: 'file' }, { now })).toEqual({ version: 1, ...manifest, title: 'file', entry: 'file', status: 'complete', primary: true, supportingFiles: ['42', 'a/b'], createdAt: 'clock', updatedAt: 'clock' });
  });
});
