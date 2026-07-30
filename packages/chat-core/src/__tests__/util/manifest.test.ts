import { describe, expect, it } from 'vitest';
import {
  artifactManifestNameFor,
  createHtmlArtifactManifest,
  inferLegacyManifest,
  matchPersistedArtifactFile,
  parseArtifactManifest,
  serializeArtifactManifest,
} from '../../util/index.js';

// Primarily manifest.ts, but 2 its below also exercise matchPersistedArtifactFile (a
// strip.ts export) in a manifest-matching context — kept together since the block as
// authored is about persisted-file matching via the manifest, not split further.
describe('artifacts/manifest', () => {
  it('creates, serializes, and round-trips a manifest', () => {
    const manifest = createHtmlArtifactManifest({ entry: 'index.html', title: 'My Page' });
    const parsed = parseArtifactManifest(serializeArtifactManifest(manifest));
    expect(parsed).toEqual(manifest);
  });

  it('rejects a manifest whose exports array contains an unknown export kind', () => {
    const tampered = JSON.stringify({ version: 1, kind: 'html', title: 't', entry: 'e.html', renderer: 'html', exports: ['html', 'exe'] });
    expect(parseArtifactManifest(tampered)).toBeNull();
  });

  it('rejects a manifest with an empty exports array', () => {
    const tampered = JSON.stringify({ version: 1, kind: 'html', title: 't', entry: 'e.html', renderer: 'html', exports: [] });
    expect(parseArtifactManifest(tampered)).toBeNull();
  });

  it('rejects a manifest at an unsupported version', () => {
    const tampered = JSON.stringify({ version: 2, kind: 'html', title: 't', entry: 'e.html', renderer: 'html', exports: ['html'] });
    expect(parseArtifactManifest(tampered)).toBeNull();
  });

  it('infers a legacy manifest kind/renderer from a bare file name, including the deck-name heuristic', () => {
    expect(inferLegacyManifest({ entry: 'notes.md' })).toMatchObject({ kind: 'markdown-document', renderer: 'markdown' });
    expect(inferLegacyManifest({ entry: 'pitch-deck.html' })).toMatchObject({ kind: 'deck', renderer: 'deck-html' });
    expect(inferLegacyManifest({ entry: 'unknownfile.bin' })).toBeNull();
  });

  it('matches a persisted file by manifest identifier even when the file name was collision-renamed', () => {
    const attrs = { identifier: 'my-artifact', type: 'text/html', title: 'T' };
    const files = [{ name: 'my-artifact-2.html', identifier: 'my-artifact' }];
    expect(matchPersistedArtifactFile(attrs, files)).toEqual(files[0]);
  });

  it('falls back to slug/extension matching when no identifier is present', () => {
    const attrs = { title: 'My Cool Page', type: 'text/html' };
    const files = [{ name: 'my-cool-page-3.html' }];
    expect(matchPersistedArtifactFile(attrs, files)).toEqual(files[0]);
  });

  it('artifactManifestNameFor derives the sidecar manifest file name from the entry', () => {
    expect(artifactManifestNameFor('index.html')).toBe('index.html.artifact.json');
  });

  it('parseArtifactManifest rejects malformed JSON rather than throwing', () => {
    expect(parseArtifactManifest('{not valid json')).toBeNull();
  });

  it('parseArtifactManifest rejects a missing/empty entry or title', () => {
    const base = { version: 1, kind: 'html', renderer: 'html', exports: ['html'] };
    expect(parseArtifactManifest(JSON.stringify({ ...base, title: 't', entry: '' }))).toBeNull();
    expect(parseArtifactManifest(JSON.stringify({ ...base, title: '', entry: 'e.html' }))).toBeNull();
    expect(parseArtifactManifest(JSON.stringify({ ...base, title: 't' }))).toBeNull();
  });

  it('parseArtifactManifest rejects a non-string kind or renderer', () => {
    const base = { version: 1, title: 't', entry: 'e.html', exports: ['html'] };
    expect(parseArtifactManifest(JSON.stringify({ ...base, kind: 1, renderer: 'html' }))).toBeNull();
    expect(parseArtifactManifest(JSON.stringify({ ...base, kind: 'html', renderer: 1 }))).toBeNull();
  });

  it('parseArtifactManifest rejects an unrecognized kind or renderer value', () => {
    const base = { version: 1, title: 't', entry: 'e.html', exports: ['html'] };
    expect(parseArtifactManifest(JSON.stringify({ ...base, kind: 'not-a-kind', renderer: 'html' }))).toBeNull();
    expect(parseArtifactManifest(JSON.stringify({ ...base, kind: 'html', renderer: 'not-a-renderer' }))).toBeNull();
  });

  it('parseArtifactManifest rejects an unrecognized status but defaults a missing one to complete', () => {
    const base = { version: 1, kind: 'html', title: 't', entry: 'e.html', renderer: 'html', exports: ['html'] };
    expect(parseArtifactManifest(JSON.stringify({ ...base, status: 'bogus' }))).toBeNull();
    expect(parseArtifactManifest(JSON.stringify(base))?.status).toBe('complete');
    expect(parseArtifactManifest(JSON.stringify({ ...base, status: 'streaming' }))?.status).toBe('streaming');
  });

  it('parseArtifactManifest passes through primary as a string collision-suffix hint or a boolean, dropping any other type', () => {
    const base = { version: 1, kind: 'html', title: 't', entry: 'e.html', renderer: 'html', exports: ['html'] };
    expect(parseArtifactManifest(JSON.stringify({ ...base, primary: 'entry.html' }))?.primary).toBe('entry.html');
    expect(parseArtifactManifest(JSON.stringify({ ...base, primary: true }))?.primary).toBe(true);
    expect(parseArtifactManifest(JSON.stringify({ ...base, primary: 42 }))?.primary).toBeUndefined();
  });

  it('parseArtifactManifest filters supportingFiles to strings only, and drops it entirely when not an array', () => {
    const base = { version: 1, kind: 'html', title: 't', entry: 'e.html', renderer: 'html', exports: ['html'] };
    expect(parseArtifactManifest(JSON.stringify({ ...base, supportingFiles: ['a.css', 42, 'b.js'] }))?.supportingFiles).toEqual(['a.css', 'b.js']);
    expect(parseArtifactManifest(JSON.stringify({ ...base, supportingFiles: 'nope' }))?.supportingFiles).toBeUndefined();
  });

  it('parseArtifactManifest passes through string timestamps/sourceSkillId and drops non-string values', () => {
    const base = { version: 1, kind: 'html', title: 't', entry: 'e.html', renderer: 'html', exports: ['html'] };
    const parsed = parseArtifactManifest(JSON.stringify({ ...base, createdAt: '2024-01-01', updatedAt: '2024-01-02', sourceSkillId: 'skill-1' }));
    expect(parsed).toMatchObject({ createdAt: '2024-01-01', updatedAt: '2024-01-02', sourceSkillId: 'skill-1' });
    const dropped = parseArtifactManifest(JSON.stringify({ ...base, createdAt: 1, updatedAt: 2, sourceSkillId: 3 }));
    expect(dropped).toMatchObject({ createdAt: undefined, updatedAt: undefined, sourceSkillId: undefined });
  });

  it('parseArtifactManifest accepts a null or string designSystemId and drops any other type', () => {
    const base = { version: 1, kind: 'html', title: 't', entry: 'e.html', renderer: 'html', exports: ['html'] };
    expect(parseArtifactManifest(JSON.stringify({ ...base, designSystemId: 'ds-1' }))?.designSystemId).toBe('ds-1');
    expect(parseArtifactManifest(JSON.stringify({ ...base, designSystemId: null }))?.designSystemId).toBeNull();
    expect(parseArtifactManifest(JSON.stringify({ ...base, designSystemId: 7 }))?.designSystemId).toBeUndefined();
  });

  it('parseArtifactManifest accepts a plain-object metadata but drops an array or non-object value', () => {
    const base = { version: 1, kind: 'html', title: 't', entry: 'e.html', renderer: 'html', exports: ['html'] };
    expect(parseArtifactManifest(JSON.stringify({ ...base, metadata: { a: 1 } }))?.metadata).toEqual({ a: 1 });
    expect(parseArtifactManifest(JSON.stringify({ ...base, metadata: ['a'] }))?.metadata).toBeUndefined();
    expect(parseArtifactManifest(JSON.stringify({ ...base, metadata: 'nope' }))?.metadata).toBeUndefined();
  });

  it('inferLegacyManifest recognizes react-component and code-snippet extensions', () => {
    expect(inferLegacyManifest({ entry: 'App.tsx' })).toMatchObject({ kind: 'react-component', renderer: 'react-component' });
    expect(inferLegacyManifest({ entry: 'App.jsx' })).toMatchObject({ kind: 'react-component', renderer: 'react-component' });
    expect(inferLegacyManifest({ entry: 'script.js' })).toMatchObject({ kind: 'code-snippet', renderer: 'code' });
    expect(inferLegacyManifest({ entry: 'styles.css' })).toMatchObject({ kind: 'code-snippet', renderer: 'code' });
  });

  it('inferLegacyManifest recognizes an svg extension and falls back to the plain kind as renderer', () => {
    expect(inferLegacyManifest({ entry: 'icon.svg' })).toMatchObject({ kind: 'svg', renderer: 'svg' });
  });

  it('inferLegacyManifest returns null for a file name with no extension at all', () => {
    expect(inferLegacyManifest({ entry: 'noextension' })).toBeNull();
  });

  it('parseArtifactManifest rejects a non-array exports value that is not even a missing key', () => {
    const tampered = JSON.stringify({ version: 1, kind: 'html', title: 't', entry: 'e.html', renderer: 'html', exports: 'html' });
    expect(parseArtifactManifest(tampered)).toBeNull();
  });

  it('inferLegacyManifest treats an ordinary (non-deck) .html file as kind html, renderer html', () => {
    expect(inferLegacyManifest({ entry: 'page.html' })).toMatchObject({ kind: 'html', renderer: 'html', primary: true });
  });

  it('inferLegacyManifest recognizes the "slides" and "pitch" deck-name heuristics independently of "deck"', () => {
    expect(inferLegacyManifest({ entry: 'my-slides.html' })).toMatchObject({ kind: 'deck', renderer: 'deck-html' });
    expect(inferLegacyManifest({ entry: 'my-pitch.html' })).toMatchObject({ kind: 'deck', renderer: 'deck-html' });
  });

  it('inferLegacyManifest falls back to the entry name as title when no title is given, and forwards metadata', () => {
    const result = inferLegacyManifest({ entry: 'notes.md', metadata: { source: 'test' } });
    expect(result).toMatchObject({ title: 'notes.md', metadata: { source: 'test' } });
  });
});
