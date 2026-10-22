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
 * of this package shipping one. See `archived provenance ledger`.
 */
import type { ArtifactFile, ArtifactManifest } from './types.js';

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
  canRender: (required: Pick<ArtifactRendererContext, "file">, optional?: Omit<ArtifactRendererContext, "file">) => boolean;
}

export interface ArtifactRenderMatch {
  renderer: ArtifactRenderer;
  manifest: ArtifactManifest;
}

/**
 * Returns `file`'s own manifest, or `null` when it has none.
 *
 * This does not guess a manifest from `file.name`'s extension. Inferring a
 * legacy manifest from a bare file extension is a *caller* concern (it
 * depends on a product's own naming conventions and artifact-kind
 * vocabulary), not something a generic renderer registry should do on a
 * caller's behalf. A caller that still needs that legacy inference should
 * resolve a manifest for the file itself — see `@jini-ai/chat`'s
 * `inferLegacyManifest` — before handing the file to this registry.
 */
export function resolveArtifactManifest({ file }: { file: ArtifactFile }): ArtifactManifest | null {
  return file.manifest ?? null;
}

export class RendererRegistry {
  private readonly renderers: readonly ArtifactRenderer[];

  constructor({ renderers }: { renderers: readonly ArtifactRenderer[] }) { this.renderers = renderers; }

  /** Renderers currently registered, in resolution order. */
  list(): readonly ArtifactRenderer[] {
    return this.renderers;
  }

  resolve({ file }: Pick<ArtifactRendererContext, "file">, { hints }: Omit<ArtifactRendererContext, "file"> = {}): ArtifactRenderMatch | null {
    const manifest = resolveArtifactManifest({ file });
    if (!manifest) return null;
    const renderer = this.renderers.find((item) => item.canRender({ file }, { hints }));
    if (!renderer) return null;
    return { renderer, manifest };
  }

  /** Returns a new registry with `renderer` appended (or replacing an existing renderer of the same id). */
  register({ renderer }: { renderer: ArtifactRenderer }): RendererRegistry {
    const withoutExisting = this.renderers.filter((item) => item.id !== renderer.id);
    return new RendererRegistry({ renderers: [...withoutExisting, renderer] });
  }
}
