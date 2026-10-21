import type { ComponentPropsWithoutRef, CSSProperties, Ref, SyntheticEvent } from 'react';

export type PooledIframeProps = ComponentPropsWithoutRef<'iframe'> & {
  cacheKey: string;
  src: string;
};

export function setForwardedRef(ref: Ref<HTMLIFrameElement> | undefined, value: HTMLIFrameElement | null) {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref) {
    (ref as { current: HTMLIFrameElement | null }).current = value;
  }
}

export function propNameToAttributeName(name: string): string {
  if (name === 'className') return 'class';
  if (name === 'htmlFor') return 'for';
  if (name === 'srcDoc') return 'srcdoc';
  if (name === 'tabIndex') return 'tabindex';
  if (name === 'referrerPolicy') return 'referrerpolicy';
  if (name === 'allowFullScreen') return 'allowfullscreen';
  if (name.startsWith('data-') || name.startsWith('aria-')) return name;
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).toLowerCase();
}

export function setAttribute(frame: HTMLIFrameElement, name: string, value: unknown) {
  if (value == null || value === false) {
    frame.removeAttribute(name);
    return;
  }
  if (value === true) {
    frame.setAttribute(name, '');
    return;
  }
  const next = String(value);
  if (frame.getAttribute(name) !== next) frame.setAttribute(name, next);
}

// CSS properties whose numeric values are dimensionless (no implicit "px").
// Matches React's own inline-style patcher's unitless-number list — needed
// here because, unlike a normal React-rendered element, this frame's style
// is synced manually (imperative DOM writes), so React's own auto-unit
// behavior for e.g. `style={{ width: 10 }}` never runs for it.
const UNITLESS_NUMBER_PROPERTIES = new Set([
  'animation-iteration-count', 'aspect-ratio', 'border-image-outset', 'border-image-slice',
  'border-image-width', 'column-count', 'flex', 'flex-grow', 'flex-shrink', 'font-weight',
  'grid-area', 'grid-column', 'grid-column-end', 'grid-column-start', 'grid-row', 'grid-row-end',
  'grid-row-start', 'line-height', 'opacity', 'order', 'orphans', 'tab-size', 'widows', 'z-index',
  'zoom', 'fill-opacity', 'flood-opacity', 'stop-opacity', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-miterlimit', 'stroke-opacity', 'stroke-width',
]);

function styleValueToString(cssKey: string, value: string | number): string {
  if (typeof value === 'number' && !UNITLESS_NUMBER_PROPERTIES.has(cssKey)) {
    return `${value}px`;
  }
  return String(value);
}

export function syncStyle(
  frame: HTMLIFrameElement,
  style: CSSProperties | undefined,
  appliedStyleKeys: Set<string>,
) {
  if (!style) {
    frame.removeAttribute('style');
    appliedStyleKeys.clear();
    return;
  }
  for (const key of Array.from(appliedStyleKeys)) {
    if (!(key in style)) {
      frame.style.setProperty(key, '');
      appliedStyleKeys.delete(key);
    }
  }
  for (const [key, value] of Object.entries(style)) {
    const cssKey = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    appliedStyleKeys.add(cssKey);
    if (value == null) {
      frame.style.setProperty(cssKey, '');
    } else {
      frame.style.setProperty(cssKey, styleValueToString(cssKey, value));
    }
  }
}

const NON_ATTRIBUTE_PROPS = new Set([
  'cacheKey', 'src', 'style', 'children', 'dangerouslySetInnerHTML',
]);

export function syncIframeProps(
  frame: HTMLIFrameElement,
  props: PooledIframeProps,
  appliedAttributes: Set<string>,
  appliedStyleKeys: Set<string>,
) {
  const nextAttributes = new Set<string>();
  for (const [name, value] of Object.entries(props)) {
    if (NON_ATTRIBUTE_PROPS.has(name) || name.startsWith('on')) {
      continue;
    }
    const attributeName = propNameToAttributeName(name);
    nextAttributes.add(attributeName);
    setAttribute(frame, attributeName, value);
  }

  for (const previous of Array.from(appliedAttributes)) {
    if (!nextAttributes.has(previous)) frame.removeAttribute(previous);
  }
  appliedAttributes.clear();
  for (const attribute of nextAttributes) appliedAttributes.add(attribute);

  syncStyle(frame, props.style, appliedStyleKeys);
  frame.onload = props.onLoad
    ? (event) => props.onLoad?.(event as unknown as SyntheticEvent<HTMLIFrameElement>)
    : null;
  setAttribute(frame, 'src', props.src);
}

/** Parks a released iframe off-DOM instead of destroying it: strips test/interaction hooks and hides it from a11y trees and tab order. */
export function parkIframeElement(frame: HTMLIFrameElement) {
  frame.onload = null;
  frame.removeAttribute('data-testid');
  frame.setAttribute('data-pool-active', 'false');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
}

/** Reverses `parkIframeElement` when a parked entry is reattached, so a reused iframe isn't left permanently hidden/inert. */
export function unparkIframeElement(frame: HTMLIFrameElement) {
  frame.removeAttribute('data-pool-active');
  frame.removeAttribute('aria-hidden');
  frame.removeAttribute('tabindex');
}
