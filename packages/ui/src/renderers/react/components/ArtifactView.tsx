/**
 * Resolves an {@link ArtifactFile} against a {@link RendererRegistry} and
 * renders it. Built-in default rendering only covers the renderer ids this
 * package ships (`html`, `svg`, `markdown` — always through the sandboxed
 * iframe for `html`/`svg`, since arbitrary SVG can carry `<script>`/event
 * handlers just like HTML). Every other renderer id (`deck-html`,
 * `react-component`, `mini-app`, `design-system`, `code`, `diagram`, or any
 * host-registered custom id) requires the host to supply a `slots.renderers`
 * entry; without one, a fallback message is shown instead of guessing at
 * how to render host-specific content.
 */
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { RendererRegistry, type ArtifactRenderMatch } from '../../registry.js';
import type { ArtifactFile } from '../../types.js';
import type { BuildSrcDocOptions } from '../../srcdoc/build.js';
import { renderMarkdownToSafeHtml } from '../../renderers/markdown.js';
import { useT } from '../i18n.js';
import { SrcDocSandbox } from './SrcDocSandbox.js';
import { AnnotationCanvas, type AnnotationCanvasProps } from '../../annotation-canvas/index.js';

export interface ArtifactViewSlotProps {
  file: ArtifactFile;
  match: ArtifactRenderMatch;
}

export type ArtifactViewSlot = (props: ArtifactViewSlotProps) => ReactNode;

export interface ArtifactViewSlots {
  /** Keyed by `ArtifactRenderer.id`. Takes priority over this component's own built-in rendering when present, including for `html`/`svg`/`markdown`. */
  renderers?: Partial<Record<string, ArtifactViewSlot>> | undefined;
}

export interface ArtifactViewProps {
  file: ArtifactFile;
  registry: RendererRegistry;
  /** Passed through to `registry.resolve({ file }, { hints })`. */
  hints?: Record<string, unknown> | undefined;
  /** Passed through to `SrcDocSandbox` for the built-in `html`/`svg` rendering. */
  srcDocOptions?: BuildSrcDocOptions | undefined;
  slots?: ArtifactViewSlots | undefined;
  className?: string | undefined;
  /**
   * Wraps whatever this artifact resolves to render (a built-in renderer, a
   * host slot, or the fallback message) in an `<AnnotationCanvas>` overlay —
   * this is the annotation-canvas feature's actual integration point with
   * the renderer-registry pipeline, rather than a standalone component a
   * caller bolts on separately. Omit entirely to render without any
   * annotation overlay.
   */
  annotation?: Omit<AnnotationCanvasProps, 'children'> | undefined;
}

export function ArtifactView({ file, registry, hints, srcDocOptions, slots, className, annotation }: ArtifactViewProps) {
  const t = useT();
  const match = useMemo(() => registry.resolve({ file }, { hints }), [registry, file, hints]);

  const wrap = (node: ReactNode): ReactNode => (annotation ? <AnnotationCanvas {...annotation}>{node}</AnnotationCanvas> : node);

  if (!match) {
    return wrap(
      <div className={className} role="status">
        {t('No renderer is registered for this artifact.')}
      </div>,
    );
  }

  const slotRenderer = slots?.renderers?.[match.renderer.id];
  if (slotRenderer) return wrap(<>{slotRenderer({ file, match })}</>);

  return wrap(renderBuiltIn({ file, match, t }, { className, srcDocOptions }));
}

type Translate = ReturnType<typeof useT>;

/** Built-in rendering for the renderer ids this package ships; any other id gets the "supply a slot" fallback message. */
function renderBuiltIn(
  { file, match, t }: { file: ArtifactFile; match: ArtifactRenderMatch; t: Translate },
  { className, srcDocOptions }: { className?: string | undefined; srcDocOptions?: BuildSrcDocOptions | undefined },
): ReactNode {
  const content = file.content ?? '';
  switch (match.renderer.id) {
    case 'html':
    case 'svg':
      return <SrcDocSandbox className={className} html={content} options={srcDocOptions} title={match.manifest.title} />;
    case 'markdown': {
      const html = match.renderer.renderPartial ? match.renderer.renderPartial(content) : renderMarkdownToSafeHtml(content);
      // eslint-disable-next-line react/no-danger -- html is produced by renderMarkdownToSafeHtml, which escapes/allow-lists links; see markdown.ts.
      return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
    }
    default:
      return (
        <div className={className} role="status">
          {t('No renderer registered for "{rendererId}" — supply one via slots.renderers.', {
            rendererId: match.renderer.id,
          })}
        </div>
      );
  }
}
