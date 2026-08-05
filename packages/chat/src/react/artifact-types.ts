/**
 * @module artifact-types
 *
 * Minimal `ArtifactFile`/`ArtifactRenderer`/`RendererRegistry` shapes,
 * defined locally per this task's SCOPE NOTE: r4b calls the artifact-renderer
 * package `@jini-ai/artifacts-react`; the actual locked name
 * (`ADS-memory/reports/jini-port/extraction-plan.md` §3) is `@jini-ai/renderers-react`, which
 * is still a placeholder stub being built in a separate session. `chat-react`
 * needs these shapes now (for `useArtifactStream` and the `ArtifactFile`
 * field on `ProjectContextValue`), so they are defined here to the exact
 * shape r4b §2 specifies, with the intent that a future pass re-points every
 * import below at `@jini-ai/renderers-react`'s real exports once that package
 * lands, deletes this file, and removes the re-export from `index.ts`.
 *
 * TODO(renderers-react): replace this file's contents with
 * `export * from '@jini-ai/renderers-react'` (or the equivalent named
 * re-exports) once `@jini-ai/renderers-react` ships real `ArtifactFile`/
 * `ArtifactRenderer`/`RendererRegistry` implementations. Do not block this
 * package's other work on that package landing first.
 */
import type { ArtifactManifest } from '@jini-ai/chat/core';

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
 * A minimal ordered registry of `ArtifactRenderer`s: first-registered,
 * first-matched (later registrations can still override by registering
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

  /** The first registered renderer whose `canRender` accepts `ctx`, or `null`. */
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
