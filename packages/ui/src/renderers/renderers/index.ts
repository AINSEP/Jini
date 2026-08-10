import { RendererRegistry } from '../registry.js';
import { HtmlRenderer } from './html.js';
import { MarkdownRenderer, renderMarkdownToSafeHtml } from './markdown.js';
import { SvgRenderer } from './svg.js';
import { ReactComponentRenderer } from './react-component.js';

export { HtmlRenderer } from './html.js';
export { MarkdownRenderer, renderMarkdownToSafeHtml } from './markdown.js';
export { SvgRenderer } from './svg.js';
export { ReactComponentRenderer } from './react-component.js';

/**
 * A registry seeded with every renderer this package ships. Deliberately
 * excludes `deck-html` — see `registry.ts`'s doc comment; a host that wants
 * deck rendering registers its own via `.register(...)`.
 */
export function createDefaultRendererRegistry(): RendererRegistry {
  return new RendererRegistry([HtmlRenderer, MarkdownRenderer, SvgRenderer, ReactComponentRenderer]);
}
