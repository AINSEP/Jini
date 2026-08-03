/**
 * The renderer registry — resolves which registered {@link ArtifactRenderer}
 * (if any) should render a given {@link ArtifactFile}.
 *
 * Origin: `apps/web/src/artifacts/renderer-registry.ts` in the origin project
 * (108 lines). Ported verbatim in shape; generified `ProjectFile` →
 * {@link ArtifactFile} and dropped the built-in `deck-html` renderer — deck
 * rendering needs a host-injected postMessage bridge (see
 * `srcdoc/bridge.ts`), so a host registers its own `deck-html`
 * {@link ArtifactRenderer} into the registry instance it constructs instead
 * of this package shipping one. See `source-map.md`.
 */
import type { ArtifactManifest } from '@jini-ai/chat/core';
import { inferLegacyManifest } from '@jini-ai/chat/core';
import type { ArtifactFile } from './types.js';

export interface ArtifactRendererContext {
  file: ArtifactFile;
  /** Free-form hints a host passes alongside the file (e.g. `{ isDeckHint: true }`). Renderers read only the keys they know about. */
  hints?: Record<string, unknown> | undefined;
}

export interface ArtifactRenderer {
  id: string;
  /**
   * Whether this renderer can receive partial content during streaming.
   * - true + renderPartial defined → renderer produces useful intermediate output
   * - true without renderPartial → renderer tolerates partial content but
   *   should be considered visually meaningful only when status === "complete"
   * - false → consumer should show a loading state until status === "complete"
   */
  supportsStreaming: boolean;
  renderPartial?: ((content: string) => string) | undefined;
  canRender: (ctx: ArtifactRendererContext) => boolean;
}

export interface ArtifactRenderMatch {
  renderer: ArtifactRenderer;
  manifest: ArtifactManifest;
}

export function resolveArtifactManifest(file: ArtifactFile): ArtifactManifest | null {
  return file.manifest ?? inferLegacyManifest({ entry: file.name });
}

export class RendererRegistry {
  constructor(private readonly renderers: readonly ArtifactRenderer[]) {}

  /** Renderers currently registered, in resolution order. */
  list(): readonly ArtifactRenderer[] {
    return this.renderers;
  }

  resolve(ctx: ArtifactRendererContext): ArtifactRenderMatch | null {
    const manifest = resolveArtifactManifest(ctx.file);
    if (!manifest) return null;
    const renderer = this.renderers.find((item) => item.canRender(ctx));
    if (!renderer) return null;
    return { renderer, manifest };
  }

  /** Returns a new registry with `renderer` appended (or replacing an existing renderer of the same id). */
  register(renderer: ArtifactRenderer): RendererRegistry {
    const withoutExisting = this.renderers.filter((item) => item.id !== renderer.id);
    return new RendererRegistry([...withoutExisting, renderer]);
  }
}
