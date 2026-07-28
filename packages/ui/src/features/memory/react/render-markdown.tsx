// Minimal Markdown → safe HTML renderer for a saved memory entry's preview
// body. OD's real `runtime/markdown.tsx` (2,881 lines) is chat/artifact
// rendering territory, explicitly deferred to `@injini/chat-react`/
// `@injini/renderers-react` (see `packages/ui/source-map.md`) — this is a
// scoped-down local reimplementation covering just this slice's one need:
// render a memory body's GFM Markdown as read-only preview text. Built on
// `micromark`, already a real dependency of this package (see
// `src/utils/markdown-scroll-sync.ts`). `micromark` escapes raw HTML in the
// input by default (no `allowDangerousHtml`), so this is XSS-safe without
// an extra sanitizer pass.
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';

export function renderMarkdown(body: string) {
  const html = micromark(body, {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
  });
  // eslint-disable-next-line react/no-danger -- `html` is micromark's own
  // escaped output (raw HTML in the source is neutralized, not passed
  // through), so this is not an unsanitized-input XSS risk.
  return <div className="memory-markdown-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
