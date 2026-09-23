import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  const fakeBody = document.createElement('body');
  return {
    fakeBody,
    editor: {
      Components: { addType: vi.fn() },
      Canvas: { getBody: vi.fn(() => fakeBody) },
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

    // A block move/clone/delete fires component:remove (and, for a move, an add) on the live tree —
    // the toolbar Interactive scope does not yet turn off (see the plan's Owner question 2).
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
