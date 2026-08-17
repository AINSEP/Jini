import { describe, expect, it } from 'vitest';
import { createDefaultRendererRegistry } from '../index.js';
import type { ArtifactFile, ArtifactManifest } from '../../types.js';

describe('createDefaultRendererRegistry', () => {
  const registry = createDefaultRendererRegistry();

  // Extension-based manifest inference was removed from resolveArtifactManifest
  // (see registry.ts), so routing now always goes through an explicit
  // manifest rather than a bare file name/kind. The manifest kind/renderer
  // values below match what the old inference would have produced for each
  // extension, so this still verifies the four bundled renderers are wired
  // correctly into one registry.
  it.each([
    { name: 'index.html', kind: 'html', manifestKind: 'html', renderer: 'html' },
    { name: 'notes.md', kind: 'text', manifestKind: 'markdown-document', renderer: 'markdown' },
    { name: 'icon.svg', kind: 'image', manifestKind: 'svg', renderer: 'svg' },
  ] as const)('resolves $name to the $renderer renderer via an explicit manifest', ({ name, kind, manifestKind, renderer }) => {
    const manifest: ArtifactManifest = {
      version: 1,
      kind: manifestKind,
      title: 't',
      entry: name,
      renderer,
      exports: [],
    };
    const file: ArtifactFile = { name, kind, content: '', manifest };
    expect(registry.resolve({ file })?.renderer.id).toBe(renderer);
  });

  it('does not ship a deck-html renderer', () => {
    expect(registry.list().some((r) => r.id === 'deck-html')).toBe(false);
  });

  it('a host can register its own deck-html renderer', () => {
    const withDeck = registry.register({
      id: 'deck-html',
      supportsStreaming: false,
      canRender: ({ file }) => file.name === 'deck.html',
    });
    // resolve() gates on a resolvable manifest before it ever consults a
    // renderer's own canRender, so the file needs an explicit manifest even
    // though this custom deck-html renderer's canRender does not read one.
    const manifest: ArtifactManifest = {
      version: 1,
      kind: 'deck',
      title: 't',
      entry: 'deck.html',
      renderer: 'deck-html',
      exports: [],
    };
    const match = withDeck.resolve({ file: { name: 'deck.html', kind: 'html', content: '', manifest } });
    expect(match?.renderer.id).toBe('deck-html');
  });
});
