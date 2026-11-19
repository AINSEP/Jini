import { createElement, useMemo, type ReactElement } from 'react';

/**
 * Shape elements `AdminNavEntry.icon` markup may use. A host draws its own glyphs as raw inner
 * SVG (see that field's doc comment in `core/manifest/types.ts`), so this can't be a fixed set of
 * named icons — but it also means the string reaching {@link Icon} was written by whoever owns the
 * nav entry, which soon enough will be a descriptor rather than code. `g` is included so multi-path
 * icons can group and transform their pieces together.
 */
const ICON_ALLOWED_TAGS: ReadonlySet<string> = new Set(['path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'g']);

/**
 * Presentation attributes let through on an icon shape, mapped from their SVG/XML spelling to the
 * camelCase prop name React expects. Anything not listed here — `style`, `href`/`xlink:href`, every
 * `on*` handler — is dropped by {@link sanitizeIconNode} rather than passed through, so there is no
 * allowlist gap to keep in sync with a separate denylist.
 */
const ICON_ALLOWED_ATTRS: Record<string, string> = {
  d: 'd',
  cx: 'cx',
  cy: 'cy',
  r: 'r',
  rx: 'rx',
  ry: 'ry',
  x: 'x',
  y: 'y',
  width: 'width',
  height: 'height',
  x1: 'x1',
  y1: 'y1',
  x2: 'x2',
  y2: 'y2',
  points: 'points',
  transform: 'transform',
  fill: 'fill',
  'fill-rule': 'fillRule',
  opacity: 'opacity',
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'clip-rule': 'clipRule',
};

/**
 * Rebuilds one parsed element as a React element, keeping only {@link ICON_ALLOWED_TAGS} /
 * {@link ICON_ALLOWED_ATTRS}. This is what stands in for `dangerouslySetInnerHTML`: the browser's
 * own parser does the tokenizing (far less error-prone than a hand-rolled regex over SVG/XML), and
 * this function decides what survives the trip into React's tree — a `<script>`, a `<foreignObject>`
 * carrying arbitrary HTML, an `<image>`/`<use>` reference, or an `onload=` attribute all fail to
 * match anything on either allowlist and are simply not there afterward, whatever they contained.
 */
function sanitizeIconNode(node: Element, key: number): ReactElement | null {
  const tag = node.tagName.toLowerCase();
  if (!ICON_ALLOWED_TAGS.has(tag)) return null;

  // `key` goes straight into the props object — `createElement` pulls it out as the element's
  // reserved key rather than forwarding it to the DOM, the same as writing `key={key}` in JSX.
  const props: Record<string, string | number> = { key };
  for (const attr of Array.from(node.attributes)) {
    const propName = ICON_ALLOWED_ATTRS[attr.name.toLowerCase()];
    if (propName) props[propName] = attr.value;
  }

  const children = Array.from(node.children)
    .map((child, i) => sanitizeIconNode(child, i))
    .filter((child): child is ReactElement => child !== null);

  return createElement(tag, props, children.length ? children : undefined);
}

/**
 * Parses one `AdminNavEntry.icon` string into a sanitized element list. Wrapping in a throwaway
 * `<svg>` document (never attached to the page — this is markup parsing, not rendering) lets the
 * browser's own XML parser validate structure for free: malformed markup surfaces as a
 * `parsererror` node, which is treated the same as empty input — the row loses its icon, not its
 * label or link.
 */
function parseIconMarkup(markup: string): ReactElement[] {
  if (!markup) return [];
  const iconMarkupParser = new DOMParser();
  const doc = iconMarkupParser.parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
    'image/svg+xml',
  );
  if (doc.getElementsByTagName('parsererror').length > 0) return [];
  return Array.from(doc.documentElement.children)
    .map((child, i) => sanitizeIconNode(child, i))
    .filter((child): child is ReactElement => child !== null);
}

export function Icon(props: { markup: string }) {
  // Re-parsing on every keystroke of an unrelated state update would be wasted work for a string
  // that, in practice, never changes after the nav manifest is built.
  const children = useMemo(() => parseIconMarkup(props.markup), [props.markup]);
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.5}>
      {children}
    </svg>
  );
}

