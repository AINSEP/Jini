/**
 * `isComponent` (passed to `editor.Components.addType` — see `react/hooks/useInteractiveHtmlEditor.ts`)
 * is not always called with a real DOM `Element`. GrapesJS also invokes it during headless/internal
 * re-parses — confirmed live: `ComponentTextView.syncContent`'s re-parse of RTE-edited content
 * (`Components.parseString` -> `ParserHtml.detectNode`) passes a lightweight parsed-node object
 * instead, whose `attributes` is a plain object rather than a DOM `NamedNodeMap`, with no
 * `.hasAttribute` method at all. Calling `.hasAttribute` unconditionally throws a `TypeError` inside
 * GrapesJS's own parser on every RTE-driven edit, which silently aborts that re-parse before it ever
 * reaches the component model. `el.attributes` is present on both shapes (a real `NamedNodeMap` or
 * GrapesJS's plain object), so checking it directly is the one path guaranteed to work regardless of
 * which parse mode called this. An `isProtectedElement` predicate passed to `InteractiveHtmlEditor`
 * that checks attributes should use this instead of `el.hasAttribute` directly.
 */
export function hasAttributeOnAnyNodeShape(el: Element, attr: string): boolean {
  if (typeof el.hasAttribute === 'function') return el.hasAttribute(attr);
  const attributes = (el as unknown as { attributes?: Record<string, unknown> }).attributes;
  return !!attributes && Object.prototype.hasOwnProperty.call(attributes, attr);
}
