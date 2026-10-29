/**
 * `RenderService` backed by a hidden `BrowserWindow` and Electron's native
 * `webContents.printToPDF`/`capturePage` — per the task brief, this
 * package must NOT reimplement PDF/PNG rendering, only wire up what
 * Electron already does natively. Not a port of OD's `deck-capture.ts`/
 * `pdf-export.ts` (those are design/slide-specific business logic that
 * would layer on top of this same port OD-side).
 */
import {
  RenderServiceError,
  type CaptureOptions,
  type RenderService,
  type RenderToPdfOptions,
} from '../render-service.js';
import type { ElectronBrowserWindowFactory } from './electron-surfaces.js';
import { withRenderWindow } from './render-window.js';
import { captureElectronUrl, type ElectronUrlCaptureOptions, type ElectronUrlCapturePoolPort } from './electron-url-capture.js';
import type { UrlCaptureRequest, UrlCaptureResult } from '../url-capture.js';

/** Bind HTML exports and bounded URL capture to an injected native window factory.
 * @example const service = createElectronRenderService({ createBrowserWindow, capturePool });
 * @complexity O(1) setup; each operation owns one temporary native window.
 */
export function createElectronRenderService({ createBrowserWindow, capturePool }: { createBrowserWindow: ElectronBrowserWindowFactory; capturePool: ElectronUrlCapturePoolPort }, _options = {}): RenderService & {
  captureUrl(request: UrlCaptureRequest, options?: ElectronUrlCaptureOptions): Promise<UrlCaptureResult>;
} {
  return {
    captureUrl(request: UrlCaptureRequest, options: ElectronUrlCaptureOptions = {}): Promise<UrlCaptureResult> {
      return captureElectronUrl({ createBrowserWindow, capturePool, request }, options);
    },
    async renderToPdf({ html }: { html: string }, options: RenderToPdfOptions = {}): Promise<Uint8Array> {
      const buffer = await withRenderWindow({ createBrowserWindow, html, options, run: (win) =>
        win.webContents.printToPDF({
          landscape: options.landscape ?? false,
          printBackground: options.printBackground ?? true,
          ...(options.pageWidth != null && options.pageHeight != null
            ? { pageSize: { width: options.pageWidth, height: options.pageHeight } }
            : {}),
          ...(options.margins == null ? {} : { margins: options.margins }),
        }),
      });
      return new Uint8Array(buffer);
    },

    async capture({ html }: { html: string }, options: CaptureOptions = {}): Promise<Uint8Array> {
      const image = await withRenderWindow({ createBrowserWindow, html, options, run: (win) => win.webContents.capturePage({}, { rect: options.clip }) });
      return new Uint8Array(image.toPNG());
    },

    async exportArtifact({ format }): Promise<unknown> {
      throw new RenderServiceError({ message: `exportArtifact format "${format}" is not implemented by the Electron adapter`, code: 'not-implemented' });
    },
  };
}
