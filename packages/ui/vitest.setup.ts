import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
// Registers jest-dom's DOM matchers (toBeInTheDocument, toHaveAttribute,
// etc.) on vitest's `expect` — added alongside `features/viewer-shell`
// (2026-07-17), the first task in this package to want those matchers;
// prior feature tests asserted against raw DOM/text-content instead. See
// `packages/ui/source-map.md`. (Independently re-added for the
// settings-dialog feature's tests too, same reasoning — this augments
// `expect` globally, so it's harmless either way.)
import '@testing-library/jest-dom/vitest';

// Unmounts every React tree rendered by @testing-library/react between
// tests so DOM assertions (getByTestId, etc.) never see leftover markup
// from a previous test's render().
afterEach(() => {
  cleanup();
});

// jsdom implements zero canvas rendering by design (real 2D drawing needs
// the native `canvas` npm package, a heavy Cairo/Pango-backed addon this
// repo deliberately doesn't take on as a devDependency for one package's
// tests). This single fake 2D context satisfies two independent consumers
// that both need `HTMLCanvasElement.prototype.getContext('2d')` to return
// something usable:
//
// - `@excalidraw/excalidraw`'s dev bundle runs an unconditional
//   module-load-time capability probe
//   (`"filter" in document.createElement("canvas").getContext("2d")`) that
//   throws under jsdom's real (unimplemented) `getContext`, crashing the
//   import itself before any test body runs — not just canvas-drawing
//   tests. Every `@jini-ai/ui` test that touches `@excalidraw/excalidraw`
//   (directly or via `features/sketch-editor`) always renders against the
//   package's own fake engine (`createFakeSketchEditorEngine`), never the
//   real `<Excalidraw>` canvas — this shim exists only to let the real
//   module load without crashing, since importing `dependencies.ts` for its
//   real-binding shape (see `dependencies.test.ts`) is legitimate even when
//   no test renders it.
// - `renderers/annotation-canvas`'s drawing/redraw logic (`drawing.ts`,
//   `useAnnotationCanvas`'s `redraw`/`compositeWithBackground`) is
//   unit-tested against a hand-rolled fake `CanvasRenderingContext2D`
//   passed in directly (see `drawing.test.ts`'s `fakeCtx()`), but the
//   *hook's own* browser-capability guard and its calls to
//   `canvas.getContext('2d')` need this global stub to exercise
//   end-to-end through a mounted `<AnnotationCanvas>` or a hook test with a
//   real canvas ref assigned — hence the broader method/property set below
//   (folded in when `@jini-ai/renderers-react` moved into this package as
//   `./renderers`) beyond what Excalidraw's probe alone requires.
if (typeof HTMLCanvasElement !== 'undefined') {
  const context2d = {
    filter: 'none',
    fillRect: () => {},
    clearRect: () => {},
    strokeRect: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: () => {},
    createImageData: () => [],
    setTransform: () => {},
    drawImage: () => {},
    save: () => {},
    fillText: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    stroke: () => {},
    setLineDash: () => {},
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    arc: () => {},
    fill: () => {},
    measureText: () => ({ width: 0 }),
    transform: () => {},
    rect: () => {},
    clip: () => {},
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    font: '',
    textBaseline: '',
    shadowColor: '',
    shadowBlur: 0,
  } as unknown as CanvasRenderingContext2D;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (HTMLCanvasElement.prototype as any).getContext = () => context2d;
  // jsdom *does* define `toBlob` (so a feature-detection `if (!...)` guard
  // would never fire), it just throws "Not implemented" when called — always
  // override it outright. Needed by `renderers/annotation-canvas`'s
  // `useAnnotationCanvas` hook to build thumbnail previews for attached
  // images.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (HTMLCanvasElement.prototype as any).toBlob = (callback: (blob: Blob | null) => void, type?: string) => {
    callback(new Blob(['fake-png-bytes'], { type: type || 'image/png' }));
  };
}

// jsdom does not implement `window.matchMedia`. Several features call it
// unconditionally as part of light/dark theme detection (this package's own
// `renderers/shiki.ts`'s `isDarkMode`, plus `features/sketch-editor`'s
// `dom.ts`/`useSketchTheme.ts` and `utils/smooth-scroll-to-top.ts`, both of
// which already guard the call with optional chaining or a `typeof`
// check — this stub reports the exact same "no preference" outcome those
// guards fall back to when `matchMedia` is absent, so it changes nothing
// for them); this stub always reports "no preference" so tests can exercise
// those paths without a real browser. Individual tests that need a specific
// `matches` value stub over this with `vi.stubGlobal`/`vi.spyOn` themselves.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom does not implement `URL.createObjectURL`/`revokeObjectURL`.
// `renderers/annotation-canvas`'s `useAnnotationCanvas` hook calls these to
// build thumbnail previews for attached images; this stub returns a stable
// fake URL per call so tests can exercise that flow without a real browser.
// Guarded, not a hard override: other features in this package (e.g.
// `file-dropzone`, `asset-tree-browser`) each install their own
// `vi.stubGlobal('URL', ...)` per test to assert on a specific mock, which
// fully replaces this fallback for the duration of that test regardless.
let fakeObjectUrlCounter = 0;
if (typeof URL !== 'undefined' && !URL.createObjectURL) {
  URL.createObjectURL = () => `blob:jini-fake-${(fakeObjectUrlCounter += 1)}`;
}
if (typeof URL !== 'undefined' && !URL.revokeObjectURL) {
  URL.revokeObjectURL = () => {};
}

// jsdom never defines `window.CanvasRenderingContext2D` at all (unlike
// `getContext`, which it defines but throws — see above). The
// `renderers/annotation-canvas`'s `useAnnotationCanvas` hook's own
// browser-capability guard (`typeof window.CanvasRenderingContext2D ===
// 'undefined'`) needs the class to exist as a value, not just working
// `getContext`/`toBlob` calls.
if (typeof window !== 'undefined' && typeof window.CanvasRenderingContext2D === 'undefined') {
  (window as unknown as { CanvasRenderingContext2D: unknown }).CanvasRenderingContext2D = class FakeCanvasRenderingContext2D {};
}

// jsdom never actually loads image resources (no network fetching of
// `src`), so a real `new Image()`'s `onload`/`onerror` never fire.
// `renderers/annotation-canvas`'s `compositeWithBackground` awaits exactly
// that event to rasterize a captured snapshot's data URL — this stub fires
// `onload` on the next microtask for any `src` starting with `data:`/
// `blob:` (what this flow ever assigns) so the await resolves
// deterministically, and `onerror` otherwise. No other feature in this
// package constructs `new Image()` (verified via
// `grep -rn "new Image("`), so overriding it unconditionally (rather than
// guarding on an existing value, unlike the stubs above) is safe.
if (typeof window !== 'undefined') {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 100;
    height = 100;
    private _src = '';
    get src() {
      return this._src;
    }
    set src(value: string) {
      this._src = value;
      queueMicrotask(() => {
        if (value.startsWith('data:') || value.startsWith('blob:')) this.onload?.();
        else this.onerror?.();
      });
    }
  }
  (window as unknown as { Image: unknown }).Image = FakeImage;
  (globalThis as unknown as { Image: unknown }).Image = FakeImage;
}
