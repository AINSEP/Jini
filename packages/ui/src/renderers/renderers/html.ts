import { resolveArtifactManifest, type ArtifactRenderer } from '../registry.js';

/**
 * Renders an artifact whose manifest resolves to plain HTML (not a slide
 * deck — decks need a host-injected navigation bridge, see
 * `srcdoc/bridge.ts`, so `manifest.kind === 'deck'` / `renderer ===
 * 'deck-html'` is deliberately excluded here; a host registers its own
 * `deck-html` {@link ArtifactRenderer} for that case).
 */
export const HtmlRenderer: ArtifactRenderer = {
  id: 'html',
  supportsStreaming: false,
  canRender: ({ file, hints }) => {
    const manifest = resolveArtifactManifest(file);
    if (!manifest) return false;
    if (manifest.kind === 'deck' || manifest.renderer === 'deck-html') return false;
    if (manifest.renderer === 'html' || manifest.kind === 'html') return true;
    return file.kind === 'html' && !hints?.['isDeckHint'];
  },
};
