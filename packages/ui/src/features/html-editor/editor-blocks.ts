import type { CanvasEmbedPlaceholderDescriptor } from './canvas-embed-placeholders.js';
import { sourceElementAttributeView } from './dom.js';
import { indexSourceElements, type ElementOuterRange, type SourceElement } from './source-splice.js';

export type EditorBlockReason = 'kuinetic' | 'canvas' | 'autoplay-video' | 'scripted' | 'embed';
export interface EditorBlock extends ElementOuterRange {
  readonly tagName: string;
  readonly id?: string | undefined;
  readonly reason: EditorBlockReason;
  readonly descriptor: CanvasEmbedPlaceholderDescriptor;
  readonly element: SourceElement;
}
export interface EditorBlockOptions {
  /** Attribute-only compatibility view, matching the existing DOM/parsed-node host seam. */
  describeHostElement?: ((el: Element) => CanvasEmbedPlaceholderDescriptor | undefined) | undefined;
  isProtectedElement?: ((el: Element) => boolean) | undefined;
  translate?: ((key: string) => string) | undefined;
}
export interface EditorHtmlTarget {
  /** Zero-based occurrence among source elements sharing tagName and (when supplied) id. */
  occurrenceIndex: number;
  tagName: string;
  id?: string;
}
export type RequestEditHtml = (target: EditorHtmlTarget, options: object) => void | Promise<void>;

const LABELS: Record<EditorBlockReason, string> = {
  kuinetic: 'Animation · Kuinetic', canvas: 'Canvas', 'autoplay-video': 'Autoplay video',
  scripted: 'Scripted section', embed: 'Content',
};
const INLINE_TAGS: ReadonlySet<string> = new Set(['span', 'a', 'b', 'i', 'em', 'strong', 'small', 'mark', 's', 'u', 'sub', 'sup']);
const UNSUPPORTED_CONTEXTS: ReadonlySet<string> = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'select', 'option', 'svg', 'math', 'template']);
// A Kuinetic entrance/decoration effect (fade-up, text-reveal, split-chars, count-up…)
// only animates authored text the canvas never runs, so locking it hid Landing's headline, ledes and
// buttons behind grey cards. Such elements stay editable; their data-kui attribute round-trips like
// any other, including stagger lists and decorated containers. Layout/runtime effects (ring, pin…)
// stay locked; unknown names retain the structural rule, and data-editor="block" still forces a lock.
// Names follow Kuinetic's core entrance, text, numbers, media and interaction catalogs; the bare
// fade/reveal/text-reveal/glow spellings are also part of the editor's authored-effect contract.
const EDITABLE_EFFECTS: ReadonlySet<string> = new Set([
  'fade', 'fade-in', 'fade-up', 'fade-down', 'fade-left', 'fade-right', 'fade-blur-in', 'fade-blur-up',
  'slide-up', 'slide-down', 'slide-left', 'slide-right', 'slide-inline-start', 'slide-inline-end', 'slide-block-start', 'slide-block-end',
  'zoom-in', 'zoom-in-up', 'zoom-in-down', 'pop-in', 'flip-in-x', 'flip-in-y', 'rotate-in', 'rotate-in-left', 'rotate-in-right',
  'roll-in', 'swing-in', 'blur-in', 'bounce-in', 'bounce-in-up', 'bounce-in-down', 'back-in-up', 'back-in-down', 'reveal', 'reveal-once',
  'text-reveal', 'text-reveal-up', 'text-reveal-down', 'text-reveal-mask', 'split-chars', 'split-words', 'split-lines',
  'count-up', 'count-down', 'count-currency', 'count-percent', 'count-compact', 'odometer-roll',
  'wipe-up', 'wipe-down', 'wipe-left', 'wipe-right', 'wipe-circle', 'wipe-diagonal', 'mask-reveal', 'curtain-reveal', 'blur-up',
  'magnetic', 'glow', 'glow-pulse', 'border-glow', 'border-draw', 'beam-border', 'beam-border-auto', 'proximity-glow',
  'shine-sweep', 'lift', 'lift-shadow', 'pop', 'underline-slide', 'underline-center', 'icon-wiggle', 'icon-spin', 'icon-bounce',
]);
const RUNTIME_EFFECTS: ReadonlySet<string> = new Set([
  'ring', 'carousel', 'deck', 'slides', 'pin', 'pin-section', 'pin-until', 'pin-spacer', 'marquee', 'marquee-scroll-linked', 'accordion', 'tabs',
  'carousel-3d', 'carousel-3d-high', 'carousel-3d-low', 'carousel-3d-inside', 'carousel-orbit', 'carousel-stack',
  'carousel-fade', 'carousel-slide', 'slideshow', 'video-hero-slideshow', 'step-progress', 'stacking-cards', 'horizontal-scroll',
  'flip-reorder', 'flip-filter', 'flip-sort', 'flip-shuffle', 'grid-to-list', 'masonry-reflow', 'expand-to-modal', 'accordion-height',
  'card-flip-x', 'card-flip-y', 'flip-card', 'scroll-snap-x', 'scroll-snap-y',
]);
const TEXT_EFFECT_TAGS: ReadonlySet<string> = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'dt', 'dd', 'blockquote', 'figcaption', 'label']);
const PHRASING_TAGS: ReadonlySet<string> = new Set([...INLINE_TAGS, 'abbr', 'br', 'cite', 'code', 'data', 'dfn', 'img', 'kbd', 'q', 'samp', 'time', 'var', 'wbr']);
const isPhrasingOnly = (el: SourceElement): boolean => el.children.every(child => PHRASING_TAGS.has(child.tagName) && isPhrasingOnly(child));
const isEditableEffect = (el: SourceElement): boolean => {
  if (el.attributes['data-editor'] === 'block') return false;
  // Quoted selectors and timing/color functions may contain commas, which are not effect separators.
  const effects = (el.attributes['data-kui'] ?? '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\([^)]*\)/g, '')
    .split(',').map(segment => segment.trim().split(/\s+/)[0]!).filter(Boolean);
  if (effects.some(effect => RUNTIME_EFFECTS.has(effect))) return false;
  if (effects.length > 0 && effects.every(effect => EDITABLE_EFFECTS.has(effect))) return true;
  if (el.attributes['data-kui'] === undefined && 'data-kui-stagger' in el.attributes) return true;
  return (TEXT_EFFECT_TAGS.has(el.tagName) || PHRASING_TAGS.has(el.tagName)) && isPhrasingOnly(el);
};

/** Outermost disjoint roots; explicit live islands veto aggregation but never host embed safety. */
export function detectEditorBlocks({ html }: { html: string }, options: EditorBlockOptions = {}):
  { ok: true; blocks: EditorBlock[]; elements: SourceElement[] } | { ok: false; problem: string } {
  const elements = indexSourceElements({ html }, {});
  const blocks: EditorBlock[] = [];
  const liveIslands = new Map<SourceElement, boolean>();
  const annotate = (el: SourceElement): boolean => {
    const descendants = el.children.map(annotate).some(Boolean);
    liveIslands.set(el, descendants);
    return el.attributes['data-editor'] === 'live' || descendants;
  };
  elements.forEach(annotate);
  let unsupported = false;
  const walk = (el: SourceElement, live: boolean, invalidAncestor: boolean) => {
    const mode = el.attributes['data-editor'];
    const isLive = mode === 'live' || (mode !== 'block' && live);
    const view = sourceElementAttributeView(el, {});
    const host = options.describeHostElement?.(view);
    const embed = !!host || !!options.isProtectedElement?.(view);
    let reason: EditorBlockReason | undefined;
    if (!isLive) {
      if (Object.keys(el.attributes).some(name => name.startsWith('data-kui')) && !isEditableEffect(el)) reason = 'kuinetic';
      else if (el.tagName === 'canvas') reason = 'canvas';
      else if (el.tagName === 'video' && 'autoplay' in el.attributes) reason = 'autoplay-video';
      else if (mode === 'block') reason = 'scripted';
    }
    if (reason && liveIslands.get(el)) reason = undefined;
    if (!reason && embed) reason = 'embed';
    const invalid = invalidAncestor || !el.outerRange || UNSUPPORTED_CONTEXTS.has(el.tagName);
    if (reason) {
      if (invalid || !el.sourceSupported) { unsupported = true; return; }
      const t = options.translate ?? ((key: string) => key);
      const id = el.attributes.id;
      const identity = id ? `#${id}` : el.attributes.class ? `.${el.attributes.class.trim().split(/\s+/).slice(0, 2).join('.')}` : el.tagName;
      blocks.push({
        ...el.outerRange!, tagName: el.tagName, ...(id ? { id } : {}), reason, element: el,
        descriptor: reason === 'embed' && host ? host : {
          kindLabel: t(LABELS[reason]), identityLabel: identity.slice(0, 64), presentation: reason === 'embed' ? 'embed' : 'runtime',
          guidanceLabel: t('Locked · Edit in HTML · Preview plays it'), inline: INLINE_TAGS.has(el.tagName),
        },
      });
      return;
    }
    el.children.forEach(child => walk(child, isLive, invalid));
  };
  elements.forEach(el => walk(el, false, false));
  return unsupported || (blocks.length > 0 && elements.some(el => !el.sourceSupported))
    ? { ok: false, problem: "Can't edit this source visually. Use HTML." } : { ok: true, blocks, elements };
}

export interface RawSourceInstance extends ElementOuterRange {
  readonly originalHtml: string;
  readonly openingTag: string;
  readonly tagName: string;
  readonly id?: string | undefined;
  readonly nonvisual: boolean;
  readonly descriptor?: CanvasEmbedPlaceholderDescriptor;
}
export interface PreparedEditorSource {
  readonly ok: true;
  readonly html: string;
  readonly markerAttribute: string;
  readonly instances: readonly RawSourceInstance[];
  readonly canvasCss: string;
}
export type EditorSourcePlan = PreparedEditorSource | { readonly ok: false; readonly html: string; readonly problem: string };

const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * Capture before GrapesJS parses. Only a mount-private lookup token reaches the parser; authored
 * source stays in model metadata. Style/script atoms use inert spans, never executable source tags.
 */
export function prepareEditorSource({ html }: { html: string }, options: EditorBlockOptions = {}): EditorSourcePlan {
  const detected = detectEditorBlocks({ html }, options);
  if (!detected.ok) return { ...detected, html };
  const instances: RawSourceInstance[] = detected.blocks.map(block => ({
    ...block, originalHtml: html.slice(block.outerStart, block.outerEnd),
    openingTag: html.slice(block.outerStart, block.openingEnd), nonvisual: false,
  }));
  const blocked = new Set(detected.blocks.map(block => block.element));
  const css: string[] = [];
  let unsupported = false;
  const walk = (el: SourceElement, enclosed: boolean, invalidAncestor: boolean) => {
    const inside = enclosed || blocked.has(el);
    const invalid = invalidAncestor || !el.outerRange;
    if (el.tagName === 'style' && el.outerRange) {
      const original = html.slice(el.outerRange.outerStart, el.outerRange.outerEnd);
      const closingLength = original.length - (original.toLowerCase().lastIndexOf('</style'));
      css.push(html.slice(el.outerRange.openingEnd, el.outerRange.outerEnd - closingLength));
    }
    if (!inside && (el.tagName === 'style' || el.tagName === 'script')) {
      if (invalid) unsupported = true;
      else instances.push({ ...el.outerRange!, originalHtml: html.slice(el.outerRange!.outerStart, el.outerRange!.outerEnd),
        openingTag: html.slice(el.outerRange!.outerStart, el.outerRange!.openingEnd), tagName: el.tagName, nonvisual: true });
    }
    el.children.forEach(child => walk(child, inside, invalid));
  };
  detected.elements.forEach(el => walk(el, false, false));
  if (unsupported || (instances.length > 0 && detected.elements.some(el => !el.sourceSupported))) {
    return { ok: false, html, problem: "Can't edit this source visually. Use HTML." };
  }
  instances.sort((a, b) => a.outerStart - b.outerStart);
  let markerAttribute = 'data-jini-raw-source-0';
  let namespace = 0;
  while (html.toLowerCase().includes(markerAttribute)) markerAttribute = `data-jini-raw-source-${++namespace}`;
  let prepared = html;
  const roots = new Map(detected.blocks.map(block => [block.outerStart, block]));
  for (let i = instances.length - 1; i >= 0; i--) {
    const instance = instances[i]!;
    const block = roots.get(instance.outerStart);
    const attrs = block?.element.attributes ?? {};
    // Data selectors may declare the root's geometry. They are inert without page scripts; keep
    // them alongside box attributes, while resource URLs, event handlers, autoplay and GrapesJS
    // parser directives stay absent. Authored data-gjs flags must not override the protected type.
    const layout = Object.keys(attrs).filter(name => ['id', 'class', 'style', 'height', 'width'].includes(name)
      || (name.startsWith('data-') && !name.startsWith('data-gjs-')))
      .map(name => ` ${name}="${escapeAttribute(attrs[name]!)}"`).join('');
    const tag = instance.nonvisual ? 'span' : instance.tagName;
    const voidTag = instance.openingEnd === instance.outerEnd;
    const shell = `<${tag} ${markerAttribute}="${i}"${layout}>${voidTag && !instance.nonvisual ? '' : `</${tag}>`}`;
    prepared = prepared.slice(0, instance.outerStart) + shell + prepared.slice(instance.outerEnd);
  }
  return { ok: true, html: prepared, markerAttribute, instances, canvasCss: css.join('\n') };
}

/** Exact authored opening tag and its source offsets; no regex-based HTML parsing or id guessing. */
export function findEditorBlockOpening(
  { html, target }: { html: string; target: EditorHtmlTarget }, _options: object = {},
): { start: number; end: number; openingTag: string } | undefined {
  let occurrence = 0;
  let result: { start: number; end: number; openingTag: string } | undefined;
  const walk = (el: SourceElement) => {
    if (el.tagName === target.tagName.toLowerCase() && (target.id === undefined || el.attributes.id === target.id)) {
      if (occurrence++ === target.occurrenceIndex && el.outerRange) {
        const { outerStart: start, openingEnd: end } = el.outerRange;
        result = { start, end, openingTag: html.slice(start, end) };
      }
    }
    el.children.forEach(walk);
  };
  indexSourceElements({ html }, {}).forEach(walk);
  return result;
}
