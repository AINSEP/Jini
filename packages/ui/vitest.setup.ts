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
// tests). `@excalidraw/excalidraw`'s dev bundle runs an unconditional
// module-load-time capability probe
// (`"filter" in document.createElement("canvas").getContext("2d")`) that
// throws under jsdom's real (unimplemented) `getContext`, crashing the
// import itself before any test body runs — not just canvas-drawing tests.
// This stub satisfies that probe with a minimal fake 2D context; it does
// not, and is not meant to, support real drawing. Every `@injini/ui` test
// that touches `@excalidraw/excalidraw` (directly or via
// `features/sketch-editor`) always renders against the package's own fake
// engine (`createFakeSketchEditorEngine`), never the real `<Excalidraw>`
// canvas — this shim exists only to let the real module load without
// crashing, since importing `dependencies.ts` for its real-binding shape
// (see `dependencies.test.ts`) is legitimate even when no test renders it.
if (typeof HTMLCanvasElement !== 'undefined') {
  const context2d = {
    filter: 'none',
    fillRect: () => {},
    clearRect: () => {},
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
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    arc: () => {},
    fill: () => {},
    measureText: () => ({ width: 0 }),
    transform: () => {},
    rect: () => {},
    clip: () => {},
  } as unknown as CanvasRenderingContext2D;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (HTMLCanvasElement.prototype as any).getContext = () => context2d;
}
