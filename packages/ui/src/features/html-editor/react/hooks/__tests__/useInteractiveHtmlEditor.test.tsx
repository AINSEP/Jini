import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANVAS_STYLES_PENDING_CLASS } from '../../../canvas-style.js';

/**
 * @file The export-safety half of the canvas-wrapper feature's proof: `useInteractiveHtmlEditor`
 * must never fold `canvasStyling.contentWrapper` into GrapesJS's `components` string, and must apply
 * it only via `applyCanvasContentWrapper` against the live canvas after `load`. `grapesjs` itself is
 * mocked — a real instance hangs under jsdom (no working iframe `load` event; confirmed by hand while
 * building this), which is also why no test in this package has ever mounted one — so this asserts
 * the WIRING (what gets passed to `grapesjs.init`, and what runs on `load`), while
 * `../../__tests__/canvas-content-wrapper.test.ts` separately proves the wrap function's own DOM
 * behavior against a real (non-GrapesJS) `<body>`.
 */

const RAW_HTML = '<p id="x">hello</p>';

/**
 * A minimal fake GrapesJS `Component`, for the splice-wiring tests below: enough of the real API
 * (`is`, `tagName`, `parent`, `components().models`, `getInnerHTML`) for `useInteractiveHtmlEditor`'s
 * own `computeComponentPath`/`recordDirtyTextEdit` to walk exactly as they would against a real
 * component tree. `_parent`/`_children` are wired by `linkFakeComponents`, mirroring how a real
 * GrapesJS parent/child relationship is bidirectional.
 */
interface FakeComponent {
  tagName: string;
  is: (type: string) => boolean;
  parent: () => FakeComponent | undefined;
  components: () => { models: FakeComponent[] };
  getInnerHTML: () => string;
  setInnerHTML: (next: string) => void;
  _parent?: FakeComponent;
  _children: FakeComponent[];
  /** GrapesJS's public `prevColl`: the collection a just-removed component was removed from. */
  prevColl?: { parent?: FakeComponent };
}

function makeFakeComponent(tagName: string, type: string, innerHTML = ''): FakeComponent {
  let inner = innerHTML;
  const self: FakeComponent = {
    tagName,
    is: (t: string) => t === type,
    parent: () => self._parent,
    components: () => ({ models: self._children }),
    getInnerHTML: () => inner,
    setInnerHTML: (next: string) => {
      inner = next;
    },
    _children: [],
  };
  return self;
}

/** Wires `children` as `parent`'s live `components()` collection, and each child's `parent()` back
 *  to `parent` — the same two-way link a real GrapesJS `Components` collection maintains. */
function linkFakeComponents(parent: FakeComponent, children: FakeComponent[]): void {
  parent._children = children;
  children.forEach((child) => {
    child._parent = parent;
  });
}

function makeFakeEditor(options: { wrapper?: FakeComponent | undefined } = {}) {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  // A real, isolated `Document` (not the shared jsdom global `document`) so tests can append/remove
  // `<link>` elements into its `<head>` without leaking them across tests — mirrors what
  // `editor.Canvas.getDocument()` returns for the real canvas iframe's document.
  const fakeDocument = document.implementation.createHTMLDocument('canvas');
  const fakeBody = fakeDocument.body;
  return {
    fakeBody,
    fakeDocument,
    editor: {
      Components: { addType: vi.fn() },
      Canvas: { getBody: vi.fn(() => fakeBody), getDocument: vi.fn((): Document | null => fakeDocument) },
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        (handlers[event] ??= []).push(cb);
      }),
      off: vi.fn(),
      getCss: vi.fn(() => ''),
      getHtml: vi.fn(() => RAW_HTML),
      getWrapper: vi.fn(() => options.wrapper),
      destroy: vi.fn(),
    },
    fire: (event: string, ...args: unknown[]) => handlers[event]?.forEach((cb) => cb(...args)),
  };
}

let lastFake: ReturnType<typeof makeFakeEditor> | undefined;
let lastInitConfig: Record<string, unknown> | undefined;
/** Set by a splice test right before `render()` so the mocked `grapesjs.init` below can hand the
 *  matching fake `Component` tree's wrapper back through `editor.getWrapper()`. */
let nextWrapper: FakeComponent | undefined;

vi.mock('grapesjs', () => ({
  default: {
    init: vi.fn((config: Record<string, unknown>) => {
      lastInitConfig = config;
      lastFake = makeFakeEditor({ wrapper: nextWrapper });
      return lastFake.editor;
    }),
  },
}));

vi.mock('../../../canvas-content-wrapper.js', () => ({
  applyCanvasContentWrapper: vi.fn(),
}));

vi.mock('../../../canvas-embed-placeholders.js', () => ({
  applyCanvasEmbedPlaceholders: vi.fn(),
}));

const { useInteractiveHtmlEditor } = await import('../useInteractiveHtmlEditor.js');
const { applyCanvasContentWrapper } = await import('../../../canvas-content-wrapper.js');
const { applyCanvasEmbedPlaceholders } = await import('../../../canvas-embed-placeholders.js');

function TestHarness({
  canvasStyling,
  describeEmbedPlaceholder,
}: {
  canvasStyling?: Parameters<typeof useInteractiveHtmlEditor>[3];
  describeEmbedPlaceholder?: Parameters<typeof useInteractiveHtmlEditor>[4];
}) {
  const { containerRef } = useInteractiveHtmlEditor(RAW_HTML, () => {}, undefined, canvasStyling, describeEmbedPlaceholder);
  return <div ref={containerRef} />;
}

describe('useInteractiveHtmlEditor — canvas content wrapper wiring', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    lastFake = undefined;
    lastInitConfig = undefined;
  });

  it('passes the raw, unwrapped host HTML as components — the wrapper never becomes real components', () => {
    render(<TestHarness canvasStyling={{ contentWrapper: [{ tagName: 'article', attributes: { class: 'post-detail wrap' } }] }} />);
    expect(lastInitConfig?.components).toBe(RAW_HTML);
  });

  it('applies the content wrapper against the live canvas body once the editor fires load', () => {
    const contentWrapper = [{ tagName: 'main' }];
    render(<TestHarness canvasStyling={{ contentWrapper }} />);

    expect(applyCanvasContentWrapper).not.toHaveBeenCalled();
    lastFake!.fire('load');
    expect(applyCanvasContentWrapper).toHaveBeenCalledTimes(1);
    expect(applyCanvasContentWrapper).toHaveBeenCalledWith(lastFake!.fakeBody, contentWrapper);
  });

  it('still fires load->wrap wiring when canvasStyling omits contentWrapper (the pre-existing no-wrapper case)', () => {
    render(<TestHarness />);
    lastFake!.fire('load');
    expect(applyCanvasContentWrapper).toHaveBeenCalledTimes(1);
    expect(applyCanvasContentWrapper).toHaveBeenCalledWith(lastFake!.fakeBody, undefined);
  });

  it('detaches the load handler on unmount, same as the existing update handler', () => {
    const { unmount } = render(<TestHarness canvasStyling={{ contentWrapper: [{ tagName: 'main' }] }} />);
    unmount();
    expect(lastFake!.editor.off).toHaveBeenCalledWith('load', expect.any(Function));
  });
});

describe('useInteractiveHtmlEditor — embed placeholder wiring', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    lastFake = undefined;
    lastInitConfig = undefined;
  });

  it('does not decorate the canvas at all when no describeEmbedPlaceholder is supplied — the pre-existing, no-op default', () => {
    render(<TestHarness />);
    lastFake!.fire('load');
    expect(applyCanvasEmbedPlaceholders).not.toHaveBeenCalled();
  });

  it('applies embed placeholders against the live canvas body once the editor fires load, same event as the content wrapper', () => {
    const describeEmbedPlaceholder = vi.fn();
    render(<TestHarness describeEmbedPlaceholder={describeEmbedPlaceholder} />);

    expect(applyCanvasEmbedPlaceholders).not.toHaveBeenCalled();
    lastFake!.fire('load');

    expect(applyCanvasEmbedPlaceholders).toHaveBeenCalledTimes(1);
    expect(applyCanvasEmbedPlaceholders).toHaveBeenCalledWith(lastFake!.fakeBody, describeEmbedPlaceholder);
  });

  it('still passes RAW_HTML, unwrapped, as components — embed placeholders never fold into the parsed document either', () => {
    render(<TestHarness describeEmbedPlaceholder={vi.fn()} />);
    expect(lastInitConfig?.components).toBe(RAW_HTML);
  });

  it('detaches the SAME load handler on unmount that both the content wrapper and embed placeholders share', () => {
    const { unmount } = render(<TestHarness describeEmbedPlaceholder={vi.fn()} />);
    unmount();
    expect(lastFake!.editor.off).toHaveBeenCalledWith('load', expect.any(Function));
    // Exactly one 'load' registration/teardown pair — embed placeholders piggyback on the content
    // wrapper's existing handler rather than adding a second `editor.on('load', ...)` registration.
    const loadOnCalls = lastFake!.editor.on.mock.calls.filter((call) => call[0] === 'load');
    const loadOffCalls = lastFake!.editor.off.mock.calls.filter((call) => call[0] === 'load');
    expect(loadOnCalls).toHaveLength(1);
    expect(loadOffCalls).toHaveLength(1);
  });
});

/**
 * @file Bug C ("one text edit rewrites the whole page's HTML" — this repo's `pages-redo` plan)
 * fix, Slice C2: proves `useInteractiveHtmlEditor` wires GrapesJS's text-edit events into
 * `source-splice.ts`'s lossless splice instead of always rebuilding the whole document, and falls
 * back to a cleaned whole-document serialization (with a dev `console.warn`) exactly when that
 * splice cannot be trusted. `grapesjs` stays mocked for the same reason the wiring tests above do —
 * see this file's top header — so a fake `Component` tree (`makeFakeComponent`/`linkFakeComponents`)
 * stands in for GrapesJS's real one, matching only the surface `computeComponentPath` and
 * `recordDirtyTextEdit` actually use.
 */

/** `<style>` is skipped from path numbering (matches `source-splice.ts`'s own `UNINDEXED_TAGS`), so
 *  the three real elements below are paths `[0]` (`p#a`), `[1]` (the embed marker), `[2]` (`p#b`).
 *  Deliberately carries three of `source-splice.ts`'s own fixture traits at once: a leading `<style>`
 *  block, a single-quoted marker attribute, and an HTML entity — so one fixture proves the splice
 *  leaves all three alone when only `p#a` is edited. */
const SPLICE_ORIGINAL_HTML =
  `<style>body{margin:0}</style>` +
  `<p id="a">Hello</p>` +
  `<div data-embed-config='{"type":"video"}'></div>` +
  `<p id="b">Old &mdash; New</p>`;

/** Builds a fake component tree shaped exactly like `SPLICE_ORIGINAL_HTML`'s real elements: a
 *  `wrapper` root (GrapesJS's `ComponentWrapper`, tagName `body`) whose children are `pA` (a `text`
 *  component, path `[0]`), `marker` (an ordinary `default`-type component — never `text` — path
 *  `[1]`), and `pB` (`text`, path `[2]`). */
function buildSpliceComponentTree() {
  const wrapper = makeFakeComponent('body', 'wrapper');
  const pA = makeFakeComponent('p', 'text', 'Hello');
  const marker = makeFakeComponent('div', 'default', '');
  const pB = makeFakeComponent('p', 'text', 'Old &mdash; New');
  linkFakeComponents(wrapper, [pA, marker, pB]);
  return { wrapper, pA, marker, pB };
}

function SpliceTestHarness({ html, onChange }: { html: string; onChange: (html: string) => void }) {
  const { containerRef } = useInteractiveHtmlEditor(html, onChange);
  return <div ref={containerRef} />;
}

describe('useInteractiveHtmlEditor — lossless splice (Bug C, Slice C2)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    lastFake = undefined;
    lastInitConfig = undefined;
    nextWrapper = undefined;
  });

  it('passes avoidInlineStyle: false to grapesjs.init', () => {
    render(<SpliceTestHarness html={SPLICE_ORIGINAL_HTML} onChange={vi.fn()} />);
    expect(lastInitConfig?.avoidInlineStyle).toBe(false);
  });

  it('emits no onChange at all while nothing has changed — mount, load, and a selection event only', () => {
    const onChange = vi.fn();
    render(<SpliceTestHarness html={SPLICE_ORIGINAL_HTML} onChange={onChange} />);
    lastFake!.fire('load');
    lastFake!.fire('component:selected');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('splices a single text edit into the original string, leaving the leading <style>, an unrelated entity, and the embed marker byte-identical', () => {
    const onChange = vi.fn();
    const { pA } = buildSpliceComponentTree();
    render(<SpliceTestHarness html={SPLICE_ORIGINAL_HTML} onChange={onChange} />);

    pA.setInnerHTML('Hello, edited');
    lastFake!.fire('component:update:content', pA);
    lastFake!.fire('update');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      `<style>body{margin:0}</style>` +
        `<p id="a">Hello, edited</p>` +
        `<div data-embed-config='{"type":"video"}'></div>` +
        `<p id="b">Old &mdash; New</p>`,
    );
  });

  it('records an RTE-close edit the same way as a direct content-update edit', () => {
    const onChange = vi.fn();
    const { pA } = buildSpliceComponentTree();
    render(<SpliceTestHarness html={SPLICE_ORIGINAL_HTML} onChange={onChange} />);

    pA.setInnerHTML('Hello, via RTE');
    lastFake!.fire('rte:disable', { model: pA }, {});
    lastFake!.fire('update');

    expect(onChange).toHaveBeenCalledWith(
      `<style>body{margin:0}</style>` +
        `<p id="a">Hello, via RTE</p>` +
        `<div data-embed-config='{"type":"video"}'></div>` +
        `<p id="b">Old &mdash; New</p>`,
    );
  });

  it('re-splices a second edit against the ORIGINAL string, keeping the first edit and leaving the marker untouched', () => {
    const onChange = vi.fn();
    const { pA, pB } = buildSpliceComponentTree();
    render(<SpliceTestHarness html={SPLICE_ORIGINAL_HTML} onChange={onChange} />);

    pA.setInnerHTML('Hello, edited');
    lastFake!.fire('component:update:content', pA);
    lastFake!.fire('update');

    pB.setInnerHTML('Brand new');
    lastFake!.fire('component:update:content', pB);
    lastFake!.fire('update');

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(
      `<style>body{margin:0}</style>` +
        `<p id="a">Hello, edited</p>` +
        `<div data-embed-config='{"type":"video"}'></div>` +
        `<p id="b">Brand new</p>`,
    );
  });

  it('never treats the embed marker as a splice target, even if a content-update event names it directly', () => {
    const onChange = vi.fn();
    const { pA, marker } = buildSpliceComponentTree();
    render(<SpliceTestHarness html={SPLICE_ORIGINAL_HTML} onChange={onChange} />);

    marker.setInnerHTML('<p>hacked</p>');
    lastFake!.fire('component:update:content', marker);
    pA.setInnerHTML('Hello, edited');
    lastFake!.fire('component:update:content', pA);
    lastFake!.fire('update');

    expect(onChange).toHaveBeenCalledWith(
      `<style>body{margin:0}</style>` +
        `<p id="a">Hello, edited</p>` +
        `<div data-embed-config='{"type":"video"}'></div>` +
        `<p id="b">Old &mdash; New</p>`,
    );
  });

  it('falls back to the cleaned whole-document serialization, with exactly one dev console.warn, on a structural (block) edit', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onChange = vi.fn();
    const { wrapper } = buildSpliceComponentTree();
    wrapper.setInnerHTML('<p id="a">Hello</p><p id="b">Old &mdash; New</p>');
    nextWrapper = wrapper;
    render(<SpliceTestHarness html={SPLICE_ORIGINAL_HTML} onChange={onChange} />);

    lastFake!.editor.getHtml.mockReturnValue(
      '<body><style>* { box-sizing: border-box; } body {margin: 0;}</style><p id="a">Hello</p></body>',
    );
    lastFake!.editor.getCss.mockReturnValue('');

    // A block move/copy/delete fires component:remove (and, for a move, an add) on the live tree —
    // the Interactive tab keeps all three (owner decision 2026-09-23).
    lastFake!.fire('component:remove');
    lastFake!.fire('update');

    expect(onChange).toHaveBeenCalledTimes(1);
    const output = onChange.mock.calls[0]?.[0] as string;
    expect(output).not.toContain('box-sizing: border-box');
    expect(output).not.toContain('<body');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('falls back to cleaned serialization, with a warn, when update fires with no recorded text edit at all', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onChange = vi.fn();
    const { wrapper } = buildSpliceComponentTree();
    wrapper.setInnerHTML('<p id="a">Hello</p><p id="b">Old &mdash; New</p>');
    nextWrapper = wrapper;
    render(<SpliceTestHarness html={SPLICE_ORIGINAL_HTML} onChange={onChange} />);

    // e.g. a style/attribute-only change: `update` fires, but no component:update:content/rte:disable
    // ever named a text component for it.
    lastFake!.fire('update');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('falls back to cleaned serialization when a dirty path can no longer be spliced (its tag drifted from the original)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onChange = vi.fn();
    const { wrapper, pA } = buildSpliceComponentTree();
    wrapper.setInnerHTML('<span>replaced</span>');
    nextWrapper = wrapper;
    render(<SpliceTestHarness html={SPLICE_ORIGINAL_HTML} onChange={onChange} />);

    // pA's real original tag at path [0] is 'p'; reporting 'span' simulates the live component's
    // model having drifted from what the original string actually has there.
    pA.tagName = 'span';
    pA.setInnerHTML('mismatched');
    lastFake!.fire('component:update:content', pA);
    lastFake!.fire('update');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

/**
 * @file Bug B ("Interactive sometimes doesn't render, or renders late, after switching tabs" — this
 * repo's `pages-redo` plan) fix, Slice B1: proves the canvas body is hidden behind
 * `CANVAS_STYLES_PENDING_CLASS` from the moment `load` fires until every `<link rel="stylesheet">`
 * GrapesJS's `canvas.styles` config put in the canvas document's `<head>` has settled (fired `load` or
 * `error`), or a 3 s cap elapses — whichever comes first — so a theme stylesheet re-fetched on every
 * mount never shows through as an unstyled flash of browser-default CSS. `grapesjs` stays mocked for
 * the same reason the wiring tests above do (this file's top header); a real `Document`
 * (`document.implementation.createHTMLDocument`, see `makeFakeEditor`) stands in for the canvas
 * iframe's document so `<link>` elements can be appended/dispatched against directly.
 */

/** Appends one `<link rel="stylesheet">` per href into `doc`'s `<head>`, mirroring what GrapesJS's
 *  `canvas.styles` config produces in the real canvas document — returns them in the same order so a
 *  test can dispatch `load`/`error` against a specific one. */
function appendStylesheetLinks(doc: Document, hrefs: readonly string[]): HTMLLinkElement[] {
  return hrefs.map((href) => {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    doc.head.appendChild(link);
    return link;
  });
}

describe('useInteractiveHtmlEditor — canvas hidden until theme stylesheets settle (Bug B, Slice B1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.clearAllMocks();
    lastFake = undefined;
    lastInitConfig = undefined;
  });

  it('hides the canvas body once load fires while a theme stylesheet is still pending', () => {
    render(<TestHarness canvasStyling={{ stylesheets: ['/theme.css'] }} />);
    appendStylesheetLinks(lastFake!.fakeDocument, ['/theme.css']);

    expect(lastFake!.fakeBody.classList.contains(CANVAS_STYLES_PENDING_CLASS)).toBe(false);
    lastFake!.fire('load');
    expect(lastFake!.fakeBody.classList.contains(CANVAS_STYLES_PENDING_CLASS)).toBe(true);
  });

  it('reveals the canvas only once every stylesheet link has settled — load and error both count', () => {
    render(<TestHarness canvasStyling={{ stylesheets: ['/a.css', '/b.css'] }} />);
    const [a, b] = appendStylesheetLinks(lastFake!.fakeDocument, ['/a.css', '/b.css']);
    lastFake!.fire('load');
    expect(lastFake!.fakeBody.classList.contains(CANVAS_STYLES_PENDING_CLASS)).toBe(true);

    a!.dispatchEvent(new Event('load'));
    expect(lastFake!.fakeBody.classList.contains(CANVAS_STYLES_PENDING_CLASS)).toBe(true); // b still pending

    b!.dispatchEvent(new Event('error'));
    expect(lastFake!.fakeBody.classList.contains(CANVAS_STYLES_PENDING_CLASS)).toBe(false);
  });

  it('reveals the canvas at the 3s cap even when a stylesheet never settles, so a dead link can never hide the page', () => {
    render(<TestHarness canvasStyling={{ stylesheets: ['/dead.css'] }} />);
    appendStylesheetLinks(lastFake!.fakeDocument, ['/dead.css']);
    lastFake!.fire('load');
    expect(lastFake!.fakeBody.classList.contains(CANVAS_STYLES_PENDING_CLASS)).toBe(true);

    vi.advanceTimersByTime(2999);
    expect(lastFake!.fakeBody.classList.contains(CANVAS_STYLES_PENDING_CLASS)).toBe(true);

    vi.advanceTimersByTime(1);
    expect(lastFake!.fakeBody.classList.contains(CANVAS_STYLES_PENDING_CLASS)).toBe(false);
  });

  it('never hides the canvas when canvasStyling has no stylesheets to wait for', () => {
    render(<TestHarness canvasStyling={{}} />);
    lastFake!.fire('load');
    expect(lastFake!.fakeBody.classList.contains(CANVAS_STYLES_PENDING_CLASS)).toBe(false);
  });

  it('reveals immediately, defensively, when the canvas document is unavailable', () => {
    render(<TestHarness canvasStyling={{ stylesheets: ['/theme.css'] }} />);
    lastFake!.editor.Canvas.getDocument.mockReturnValue(null);
    lastFake!.fire('load');
    expect(lastFake!.fakeBody.classList.contains(CANVAS_STYLES_PENDING_CLASS)).toBe(false);
  });

  it('applies the content wrapper and embed placeholders before the canvas is ever hidden', () => {
    vi.mocked(applyCanvasContentWrapper).mockImplementationOnce((body) => {
      expect((body as HTMLElement).classList.contains(CANVAS_STYLES_PENDING_CLASS)).toBe(false);
    });
    render(<TestHarness canvasStyling={{ stylesheets: ['/theme.css'] }} describeEmbedPlaceholder={vi.fn()} />);
    appendStylesheetLinks(lastFake!.fakeDocument, ['/theme.css']);

    lastFake!.fire('load');

    expect(applyCanvasContentWrapper).toHaveBeenCalledTimes(1);
    expect(applyCanvasEmbedPlaceholders).toHaveBeenCalledTimes(1);
  });

  it('cancels the pending timer and detaches stylesheet listeners on unmount, without throwing', () => {
    const { unmount } = render(<TestHarness canvasStyling={{ stylesheets: ['/theme.css'] }} />);
    const [link] = appendStylesheetLinks(lastFake!.fakeDocument, ['/theme.css']);
    const removeSpy = vi.spyOn(link!, 'removeEventListener');
    lastFake!.fire('load');

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('load', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('error', expect.any(Function));
    expect(() => vi.advanceTimersByTime(3000)).not.toThrow();
  });

  it('is idempotent when the canvas already revealed before unmount — no double-remove, no throw', () => {
    const { unmount } = render(<TestHarness canvasStyling={{}} />);
    lastFake!.fire('load'); // no stylesheets: reveals synchronously, no timer was ever set
    expect(() => unmount()).not.toThrow();
  });
});

// Embed protection (2026-09-23, Lane A). An embed marker is one atomic block: its content can never be
// edited or dropped into, but a click selects the embed itself (not the block around it), and it can
// be deliberately moved, copied or deleted like any other block. Its placeholder card is repaired after
// every structural edit, so a deleted embed never leaves a ghost card and a moved or restored one is
// never left bare.
describe('useInteractiveHtmlEditor — embed markers are selectable atomic blocks', () => {
  function ProtectedHarness({ describeEmbedPlaceholder }: { describeEmbedPlaceholder?: Parameters<typeof useInteractiveHtmlEditor>[4] }) {
    const { containerRef } = useInteractiveHtmlEditor(RAW_HTML, () => {}, () => true, {}, describeEmbedPlaceholder);
    return <div ref={containerRef} />;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.clearAllMocks();
    lastFake = undefined;
    lastInitConfig = undefined;
  });

  it('registers the protected type as selectable and removable, but never editable or droppable', () => {
    render(<ProtectedHarness />);
    const plugins = lastInitConfig!.plugins as Array<(editor: unknown) => void>;
    const addType = vi.fn();
    plugins.forEach((plugin) => plugin({ Components: { addType } }));

    expect(addType).toHaveBeenCalledTimes(1);
    const [typeName, definition] = addType.mock.calls[0]!;
    expect(typeName).toBe('protected-element');
    expect(definition.model.defaults).toEqual({
      editable: false,
      droppable: false,
      stylable: false,
      layerable: false,
      badgable: false,
      selectable: true,
      hoverable: true,
      highlightable: true,
      removable: true,
      draggable: true,
      copyable: true,
    });
  });

  it('re-applies the placeholder cards once, on the next tick, after any add or remove since load', () => {
    const describeEmbedPlaceholder = vi.fn();
    render(<ProtectedHarness describeEmbedPlaceholder={describeEmbedPlaceholder} />);
    lastFake!.fire('load');
    expect(applyCanvasEmbedPlaceholders).toHaveBeenCalledTimes(1);

    lastFake!.fire('component:remove', makeFakeComponent('p', 'text'));
    lastFake!.fire('component:add', makeFakeComponent('p', 'text'));
    expect(applyCanvasEmbedPlaceholders).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(0);
    expect(applyCanvasEmbedPlaceholders).toHaveBeenCalledTimes(2);
    expect(applyCanvasEmbedPlaceholders).toHaveBeenLastCalledWith(lastFake!.fakeBody, describeEmbedPlaceholder);
  });

  it('does not re-apply cards for adds and removes before load (GrapesJS parsing the initial document)', () => {
    render(<ProtectedHarness describeEmbedPlaceholder={vi.fn()} />);
    lastFake!.fire('component:add', makeFakeComponent('p', 'text'));
    vi.advanceTimersByTime(0);
    expect(applyCanvasEmbedPlaceholders).not.toHaveBeenCalled();
  });

  it('cancels a pending card repair on unmount', () => {
    const { unmount } = render(<ProtectedHarness describeEmbedPlaceholder={vi.fn()} />);
    lastFake!.fire('load');
    lastFake!.fire('component:remove', makeFakeComponent('p', 'text'));
    unmount();
    vi.advanceTimersByTime(0);
    expect(applyCanvasEmbedPlaceholders).toHaveBeenCalledTimes(1);
  });
});

// Slice B (text-only-plan §3, 2026-09-23). Live check P1 showed every real RTE edit taking the
// fallback: when the RTE closes, GrapesJS fires `rte:disable` BEFORE `syncContent` rewrites the text
// component's children, and that rewrite fires `component:remove`/`component:add` for the inline and
// textnode children. These tests replay that real order.
describe('useInteractiveHtmlEditor — the splice holds for real RTE edits (Slice B)', () => {
  const EDITED = `<style>body{margin:0}</style>` +
    `<p id="a">Hello, edited</p>` +
    `<div data-embed-config='{"type":"video"}'></div>` +
    `<p id="b">Old &mdash; New</p>`;

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    lastFake = undefined;
    lastInitConfig = undefined;
    nextWrapper = undefined;
  });

  it('splices the text as it is AFTER the RTE sync, with no warning, when only the text component\'s own children churn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onChange = vi.fn();
    const { pA } = buildSpliceComponentTree();
    render(<SpliceTestHarness html={SPLICE_ORIGINAL_HTML} onChange={onChange} />);

    lastFake!.fire('rte:disable', { model: pA }, {}); // pA still holds "Hello" here
    pA.setInnerHTML('Hello, edited'); // syncContent
    const removedChild = makeFakeComponent('', 'textnode', 'Hello');
    removedChild.prevColl = { parent: pA };
    lastFake!.fire('component:remove', removedChild);
    const addedChild = makeFakeComponent('', 'textnode', 'Hello, edited');
    linkFakeComponents(pA, [addedChild]);
    lastFake!.fire('component:add', addedChild);
    lastFake!.fire('update');

    expect(onChange).toHaveBeenLastCalledWith(EDITED);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('still falls back, naming the cause, when a block outside any text component is added', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onChange = vi.fn();
    const { wrapper, pA } = buildSpliceComponentTree();
    nextWrapper = wrapper;
    render(<SpliceTestHarness html={SPLICE_ORIGINAL_HTML} onChange={onChange} />);

    const clone = makeFakeComponent('p', 'text', 'Hello');
    linkFakeComponents(wrapper, [pA, clone, ...wrapper._children.slice(1)]);
    lastFake!.fire('component:add', clone);
    lastFake!.fire('update');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[useInteractiveHtmlEditor] falling back to full re-serialization: a block was added, moved, copied or deleted since mount (first: component:add <p>)',
    );
  });

  it('still falls back when a block is removed from outside any text component', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { wrapper, pB } = buildSpliceComponentTree();
    nextWrapper = wrapper;
    render(<SpliceTestHarness html={SPLICE_ORIGINAL_HTML} onChange={vi.fn()} />);

    pB.prevColl = { parent: wrapper };
    delete pB._parent;
    lastFake!.fire('component:remove', pB);
    lastFake!.fire('update');

    expect(warnSpy).toHaveBeenCalledWith(
      '[useInteractiveHtmlEditor] falling back to full re-serialization: a block was added, moved, copied or deleted since mount (first: component:remove <p>)',
    );
  });

  it('still falls back when component:remove fires with no component at all', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { wrapper } = buildSpliceComponentTree();
    nextWrapper = wrapper;
    render(<SpliceTestHarness html={SPLICE_ORIGINAL_HTML} onChange={vi.fn()} />);

    lastFake!.fire('component:remove');
    lastFake!.fire('update');

    expect(warnSpy).toHaveBeenCalledWith(
      '[useInteractiveHtmlEditor] falling back to full re-serialization: a block was added, moved, copied or deleted since mount (first: component:remove <unknown>)',
    );
  });
});
