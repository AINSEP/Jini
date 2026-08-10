import { resolveArtifactManifest, type ArtifactRenderer } from '../registry.js';

export const SvgRenderer: ArtifactRenderer = {
  id: 'svg',
  supportsStreaming: false,
  canRender: ({ file }) => {
    const manifest = resolveArtifactManifest(file);
    if (!manifest) return false;
    if (manifest.renderer === 'svg' || manifest.kind === 'svg') return true;
    return (file.kind === 'image' || file.kind === 'sketch') && /\.svg$/i.test(file.name);
  },
};
