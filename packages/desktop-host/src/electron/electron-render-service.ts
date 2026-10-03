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
  htmlToDataUrl,
  isOriginAllowed,
  withRenderTimeout,
  type CaptureOptions,
  type RenderOptions,
  type RenderService,
  type RenderToPdfOptions,
} from '../render-service.js';
import type { ElectronBrowserWindowFactory, ElectronBrowserWindowLike, ElectronWebContentsLike } from './electron-surfaces.js';

function waitForLoad(webContents: ElectronWebContentsLike): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    webContents.once({ event: 'did-finish-load', listener: () => resolve() });
    webContents.once({ event: 'did-fail-load', listener: ({ errorCode, errorDescription }) => {
      reject(new RenderServiceError({ message: `failed to load render document: ${errorDescription} (${errorCode})`, code: 'load-failed' }));
    } });
  });
}

function attachResourcePolicy(webContents: ElectronWebContentsLike, policy: RenderOptions['resourcePolicy']): void {
  if (policy?.allowNavigation !== true) {
    webContents.on({ event: 'will-navigate', listener: ({ event }) => event.preventDefault() });
  }
  // Omitted origins are an empty allowlist. Permissive rendering requires an explicit opt-out.
  webContents.session.webRequest.onBeforeRequest({ listener: ({ details, callback }) => {
    callback({ cancel: !isOriginAllowed({ url: details.url }, {
      allowedOrigins: policy?.allowedOrigins,
      allowUnrestrictedNetwork: policy?.allowUnrestrictedNetwork,
    }) });
  } });
}

async function withRenderWindow<T>(
  createBrowserWindow: ElectronBrowserWindowFactory,
  html: string,
  options: RenderOptions,
  run: (win: ElectronBrowserWindowLike) => Promise<T>,
): Promise<T> {
  const win = createBrowserWindow({}, {
    show: false,
    width: options.viewport?.width ?? 1024,
    height: options.viewport?.height ?? 768,
    webPreferences: { javascript: options.resourcePolicy?.javascript ?? true },
  });
  try {
    const task = (async () => {
      attachResourcePolicy(win.webContents, options.resourcePolicy);
      const loaded = waitForLoad(win.webContents);
      await win.loadURL({ url: htmlToDataUrl({ html }) });
      await loaded;
      return await run(win);
    })();
    return await withRenderTimeout({ promise: task }, { timeoutMs: options.timeoutMs, signal: options.signal });
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

export function createElectronRenderService({ createBrowserWindow }: { createBrowserWindow: ElectronBrowserWindowFactory }): RenderService {
  return {
    async renderToPdf({ html }: { html: string }, options: RenderToPdfOptions = {}): Promise<Uint8Array> {
      const buffer = await withRenderWindow(createBrowserWindow, html, options, (win) =>
        win.webContents.printToPDF({
          landscape: options.landscape ?? false,
          printBackground: options.printBackground ?? true,
          ...(options.pageWidth != null && options.pageHeight != null
            ? { pageSize: { width: options.pageWidth, height: options.pageHeight } }
            : {}),
          ...(options.margins == null ? {} : { margins: options.margins }),
        }),
      );
      return new Uint8Array(buffer);
    },

    async capture({ html }: { html: string }, options: CaptureOptions = {}): Promise<Uint8Array> {
      const image = await withRenderWindow(createBrowserWindow, html, options, (win) => win.webContents.capturePage({}, { rect: options.clip }));
      return new Uint8Array(image.toPNG());
    },

    async exportArtifact({ format }): Promise<unknown> {
      throw new RenderServiceError({ message: `exportArtifact format "${format}" is not implemented by the Electron adapter`, code: 'not-implemented' });
    },
  };
}
