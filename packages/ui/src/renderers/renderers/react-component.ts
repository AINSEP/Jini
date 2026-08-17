import { resolveArtifactManifest, type ArtifactRenderer } from '../registry.js';

/**
 * Matches artifacts whose manifest declares a React-component renderer.
 * This registry entry only resolves *which* renderer applies — it does not
 * itself evaluate/mount arbitrary React source (that requires a sandboxed
 * eval strategy that is inherently host-specific); a host supplies the
 * actual render function via `ArtifactView`'s `slots.renderers['react-component']`.
 */
export const ReactComponentRenderer: ArtifactRenderer = {
  id: 'react-component',
  supportsStreaming: false,
  canRender: ({ file }) => {
    const manifest = resolveArtifactManifest(file);
    if (!manifest) return false;
    return manifest.kind === 'react-component' || manifest.renderer === 'react-component';
  },
};
