/** DOM test setup for the ECharts provider's jsdom tests (vitest.config.ts routes `src/charts-*` to jsdom).
 * Imported first by each DOM test file rather than as a package-wide setup file. */
import { afterEach } from 'vitest';

afterEach(() => { document.body.replaceChildren(); });

// jsdom has no canvas, and logs "Not implemented" for getContext. ECharts only asks for a canvas to
// measure text; with none it uses its own built-in width table, the same path a canvas-less browser takes.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
