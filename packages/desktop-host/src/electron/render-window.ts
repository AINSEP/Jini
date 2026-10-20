/** Shared native render-window lifetime for HTML exports and URL captures. */
import { RenderServiceError, htmlToDataUrl, isOriginAllowed, withRenderTimeout, type RenderOptions } from '../render-service.js';
import type { ElectronBrowserWindowFactory, ElectronBrowserWindowLike, ElectronWebContentsLike } from './electron-surfaces.js';

/** HTML renderers report load events separately from their data-URL load promise. */
function waitForLoad(webContents: ElectronWebContentsLike): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    webContents.once({ event: 'did-finish-load', listener: () => resolve() });
    webContents.once({ event: 'did-fail-load', listener: ({ errorCode, errorDescription }) => {
      reject(new RenderServiceError({ message: `failed to load render document: ${errorDescription} (${errorCode})`, code: 'load-failed' }));
    } });
  });
}

/** Keep the existing HTML resource policy; URL captures install a stricter GET-only policy. */
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

function createHiddenWindow({ createBrowserWindow, options }: {
  createBrowserWindow: ElectronBrowserWindowFactory;
  options: RenderOptions;
}, _options = {}): ElectronBrowserWindowLike {
  return createBrowserWindow({}, {
    show: false,
    width: options.viewport?.width ?? 1024,
    height: options.viewport?.height ?? 768,
    webPreferences: { javascript: options.resourcePolicy?.javascript ?? true },
  });
}

/** Allocate, load and consume one hidden window, always destroying it on failure or deadline.
 * @throws RenderServiceError on abort/timeout; native failures propagate to the adapter edge.
 * @complexity O(1) lifecycle work, apart from the injected renderer operation.
 */
export async function withRenderWindow<T>(
  { createBrowserWindow, html = '', url, options, prepare, run }: {
    createBrowserWindow: ElectronBrowserWindowFactory;
    html?: string; url?: string; options: RenderOptions;
    prepare?: (win: ElectronBrowserWindowLike) => Promise<void>;
    run: (win: ElectronBrowserWindowLike) => Promise<T>;
  }, _options = {},
): Promise<T> {
  if (options.signal?.aborted) throw new RenderServiceError({ code: 'aborted', message: 'render aborted before starting' });
  const win = createHiddenWindow({ createBrowserWindow, options });
  try {
    const task = (async () => {
      await prepare?.(win);
      if (options.signal?.aborted || win.isDestroyed()) throw new RenderServiceError({ code: 'aborted', message: 'render aborted during preparation' });
      // Both paths share timeout and destruction ownership. URL capture's own factory installs
      // its strict policy before loading; HTML retains its established data-document policy.
      if (url === undefined) {
        attachResourcePolicy(win.webContents, options.resourcePolicy);
        const loaded = waitForLoad(win.webContents);
        await win.loadURL({ url: htmlToDataUrl({ html }) });
        await loaded;
      } else {
        await win.loadURL({ url });
      }
      return await run(win);
    })();
    return await withRenderTimeout({ promise: task }, { timeoutMs: options.timeoutMs, signal: options.signal });
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}
