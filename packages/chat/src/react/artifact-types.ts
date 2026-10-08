/**
 * @module artifact-types
 *
 * Chat's public streaming artifact contracts, used by useArtifactStream and
 * ProjectContextValue. The renderer implementation is available in @jini-ai/ui,
 * but direct delegation would change this compatibility surface: chat registers
 * mutably, resolves newest-first, returns unregister handles, accepts files
 * without manifests and returns the matched file. UI's registry is immutable,
 * replaces registrations by ID, requires a manifest and returns that manifest;
 * its predicate and resolve signatures also pass hints as a separate option.
 *
 * TODO(renderer-delegation): Coordinator must resolve these contracts before
 * delegating to UI. A wildcard re-export is not a behavior-preserving migration.
 */
import type { ArtifactManifest } from '../core/index.js';

/** Generic artifact-file shape a host's project/workspace file maps onto. */
export interface ArtifactFile {
  name: string;
  kind: string;
  content?: string;
  url?: string;
  manifest?: ArtifactManifest;
}

export interface ArtifactRenderContext {
  file: ArtifactFile;
  hints?: Record<string, unknown>;
}

export interface ArtifactRenderer {
  id: string;
  supportsStreaming: boolean;
  renderPartial?: (content: string) => string;
  canRender: (ctx: ArtifactRenderContext) => boolean;
}

export interface ArtifactRenderMatch {
  renderer: ArtifactRenderer;
  file: ArtifactFile;
}

/**
 * A minimal ordered registry of `ArtifactRenderer`s: newest-registered,
 * first-matched (later registrations override earlier matches by registering
 * before resolution, mirroring the tool-renderer registry's "last writer
 * wins on the same id" convention is intentionally NOT used here — artifact
 * renderers are matched by predicate, not by name, so ordering is the
 * override mechanism instead).
 */
export class RendererRegistry {
  private readonly renderers: ArtifactRenderer[] = [];

  /** Registers `renderer`, returning an unregister handle. */
  register(renderer: ArtifactRenderer): () => void {
    this.renderers.unshift(renderer);
    return () => {
      const idx = this.renderers.indexOf(renderer);
      if (idx !== -1) this.renderers.splice(idx, 1);
    };
  }

  /** The newest registered renderer whose `canRender` accepts `ctx`, or `null`. */
  resolve(ctx: ArtifactRenderContext): ArtifactRenderMatch | null {
    for (const renderer of this.renderers) {
      if (renderer.canRender(ctx)) return { renderer, file: ctx.file };
    }
    return null;
  }

  /** Visible mainly for tests. */
  list(): readonly ArtifactRenderer[] {
    return this.renderers;
  }
}
