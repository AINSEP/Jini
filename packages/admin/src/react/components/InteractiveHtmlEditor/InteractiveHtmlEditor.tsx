import {
  InteractiveHtmlEditor as HtmlEditor,
  hasAttributeOnAnyNodeShape,
  type InteractiveHtmlEditorProps as HtmlEditorProps,
} from '@jini-ai/ui/html-editor';

/**
 * @file Tovu-specific composition of `@jini-ai/ui/html-editor`'s generic `InteractiveHtmlEditor`: a
 * Page's `body_html` (the first caller — see `Tovu/apps/admin/src/features/pages/PageEditor.tsx`)
 * can carry `<div data-embed-type="…" data-embed-id="…"></div>` placeholders (and the legacy
 * `data-widget-embed`/`data-form-embed` attributes on migration-era rows) that a separate scanner
 * (`Tovu/src/widgets/html-embeds.ts`) resolves at render time — that scanner requires the div to
 * stay exactly empty and self-closing, and degrades silently, with no error, the moment anything is
 * written inside one.
 *
 * The generic `@jini-ai/ui` primitive has zero knowledge of this convention; this file is the thin
 * adapter that supplies it as an `isProtectedElement` predicate, so `PageEditor.tsx` can keep
 * importing `InteractiveHtmlEditor` from `@jini-ai/admin/react` unchanged.
 */

/** The attribute either the current (`data-embed-type`) or legacy (`data-widget-embed`,
 *  `data-form-embed`) convention uses to mark a Page HTML embed placeholder div — see
 *  `Tovu/src/widgets/html-embeds.ts`'s file header for the convention this protects. */
const EMBED_MARKER_ATTRIBUTES = ['data-embed-type', 'data-widget-embed', 'data-form-embed'] as const;

/** True when `el` carries any embed marker attribute this convention recognizes — exported for
 *  direct unit-testability without mounting the editor. Uses `hasAttributeOnAnyNodeShape` because
 *  the `isProtectedElement` predicate is invoked from inside GrapesJS's `isComponent` callback,
 *  which is not always called with a real DOM `Element` — see that helper's own doc. */
export function isProtectedEmbedElement(el: Element): boolean {
  return EMBED_MARKER_ATTRIBUTES.some((attr) => hasAttributeOnAnyNodeShape(el, attr));
}

export type InteractiveHtmlEditorProps = Omit<HtmlEditorProps, 'isProtectedElement'>;

export function InteractiveHtmlEditor(props: InteractiveHtmlEditorProps) {
  return <HtmlEditor {...props} isProtectedElement={isProtectedEmbedElement} />;
}
