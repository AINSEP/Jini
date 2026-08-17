import { describe, expect, it } from 'vitest';
import { RendererRegistry, resolveArtifactManifest, type ArtifactRenderer } from '../registry.js';
import type { ArtifactFile, ArtifactManifest } from '../types.js';

const alwaysHtml: ArtifactRenderer = {
  id: 'html',
  supportsStreaming: false,
  canRender: () => true,
};

const neverMatches: ArtifactRenderer = {
  id: 'never',
  supportsStreaming: false,
  canRender: () => false,
};

function file(overrides: Partial<ArtifactFile> = {}): ArtifactFile {
  return { name: 'index.html', kind: 'html', content: '<p>hi</p>', ...overrides };
}

// A manifest attached explicitly, used wherever a test needs `resolve()` to
// get past its manifest gate and actually exercise renderer matching.
const sampleManifest: ArtifactManifest = {
  version: 1,
  kind: 'html',
  title: 'Sample',
  entry: 'index.html',
  renderer: 'html',
  exports: [],
};

describe('resolveArtifactManifest', () => {
  it("returns the file's explicit manifest when present", () => {
    const manifest = {
      version: 1 as const,
      kind: 'markdown-document' as const,
      title: 'Explicit',
      entry: 'index.html',
      renderer: 'markdown' as const,
      exports: [],
    };
    expect(resolveArtifactManifest(file({ manifest }))).toEqual(manifest);
  });

  it('no longer infers a manifest from the file name (inference removed)', () => {
    expect(resolveArtifactManifest(file({ name: 'notes.md' }))).toBeNull();
  });

  it('returns null when the file has no manifest', () => {
    expect(resolveArtifactManifest(file({ name: 'data.bin' }))).toBeNull();
  });
});

describe('RendererRegistry', () => {
  it('resolves the first renderer whose canRender matches', () => {
    const registry = new RendererRegistry([neverMatches, alwaysHtml]);
    const match = registry.resolve({ file: file({ manifest: sampleManifest }) });
    expect(match?.renderer.id).toBe('html');
  });

  it('returns null when no manifest can be resolved', () => {
    const registry = new RendererRegistry([alwaysHtml]);
    expect(registry.resolve({ file: file({ name: 'data.bin' }) })).toBeNull();
  });

  it('returns null when no renderer matches', () => {
    const registry = new RendererRegistry([neverMatches]);
    expect(registry.resolve({ file: file({ manifest: sampleManifest }) })).toBeNull();
  });

  it('list() exposes renderers in resolution order', () => {
    const registry = new RendererRegistry([neverMatches, alwaysHtml]);
    expect(registry.list().map((r) => r.id)).toEqual(['never', 'html']);
  });

  it('register() replaces an existing renderer with the same id', () => {
    const registry = new RendererRegistry([neverMatches]);
    const replaced: ArtifactRenderer = { id: 'never', supportsStreaming: false, canRender: () => true };
    const next = registry.register(replaced);
    expect(next.list()).toHaveLength(1);
    expect(next.resolve({ file: file({ manifest: sampleManifest }) })?.renderer).toBe(replaced);
    // original registry is untouched
    expect(registry.resolve({ file: file({ manifest: sampleManifest }) })).toBeNull();
  });

  it('register() appends a renderer with a new id', () => {
    const registry = new RendererRegistry([neverMatches]);
    const next = registry.register(alwaysHtml);
    expect(next.list().map((r) => r.id)).toEqual(['never', 'html']);
  });
});
