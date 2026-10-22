import type { BrowserWindow, BrowserWindowConstructorOptions, WebContents } from 'electron';
import type {
  ElectronAppLike,
  ElectronBrowserWindowLike,
  ElectronBrowserWindowOptions,
  ElectronDialogLike,
  ElectronProtocolLike,
  ElectronShellLike,
  ElectronWebContentsLike,
} from '@jini-ai/desktop-host/electron';

// `@jini-ai/desktop-host/electron` declares object-argument contracts that the native Electron
// modules no longer satisfy structurally, so the host binds each native call here.

type ElectronModule = typeof import('electron');

export function bindElectronApp({ app }: { app: ElectronModule['app'] }): ElectronAppLike {
  return {
    requestSingleInstanceLock: () => app.requestSingleInstanceLock(),
    quit: () => app.quit(),
    on: ({ listener }) => {
      app.on('second-instance', () => listener());
    },
    getRecentDocuments: () => app.getRecentDocuments(),
    addRecentDocument: ({ path }) => app.addRecentDocument(path),
  };
}

export function bindElectronProtocol({ protocol }: { protocol: ElectronModule['protocol'] }): ElectronProtocolLike {
  return {
    registerSchemesAsPrivileged: ({ schemes }) => protocol.registerSchemesAsPrivileged(schemes),
    handle: ({ scheme, handler }) => protocol.handle(scheme, (request) => handler({ request })),
  };
}

export function bindElectronShell({ shell }: { shell: ElectronModule['shell'] }): ElectronShellLike {
  return {
    openPath: ({ path }) => shell.openPath(path),
    openExternal: ({ url }) => shell.openExternal(url),
  };
}

export function bindElectronDialog({ dialog }: { dialog: ElectronModule['dialog'] }): ElectronDialogLike {
  return {
    showOpenDialog: async (_requiredArgs, optionalArgs = {}) => {
      const result = await dialog.showOpenDialog({
        ...(optionalArgs.defaultPath == null ? {} : { defaultPath: optionalArgs.defaultPath }),
        properties: [...(optionalArgs.properties ?? [])] as NonNullable<Electron.OpenDialogOptions['properties']>,
      });
      return { canceled: result.canceled, filePaths: result.filePaths };
    },
  };
}

function bindWebContents(webContents: WebContents): ElectronWebContentsLike {
  return {
    session: {
      webRequest: {
        onBeforeRequest: ({ listener }) => {
          webContents.session.webRequest.onBeforeRequest(
            listener == null ? null : (details, callback) => listener({ details, callback }),
          );
        },
      },
    },
    loadURL: ({ url }) => webContents.loadURL(url),
    once: (({ event, listener }: { event: string; listener: (args?: unknown) => void }) => {
      if (event === 'did-fail-load') {
        webContents.once('did-fail-load', (failEvent, errorCode, errorDescription) =>
          listener({ event: failEvent, errorCode, errorDescription }),
        );
        return;
      }
      webContents.once('did-finish-load', () => listener());
    }) as ElectronWebContentsLike['once'],
    on: ({ listener }) => {
      webContents.on('will-navigate', (event, url) => listener({ event, url }));
    },
    printToPDF: (options) => webContents.printToPDF(options),
    capturePage: (_requiredArgs, optionalArgs = {}) => webContents.capturePage(optionalArgs.rect),
  };
}

export function bindBrowserWindow(window: BrowserWindow): ElectronBrowserWindowLike {
  return {
    webContents: bindWebContents(window.webContents),
    loadURL: ({ url }) => window.loadURL(url),
    show: () => window.show(),
    hide: () => window.hide(),
    focus: () => window.focus(),
    close: () => window.close(),
    destroy: () => window.destroy(),
    isDestroyed: () => window.isDestroyed(),
    on: ({ listener }) => {
      window.on('closed', () => listener());
    },
  };
}

export function toBrowserWindowOptions(options: ElectronBrowserWindowOptions = {}): BrowserWindowConstructorOptions {
  return { ...options, webPreferences: { ...options.webPreferences } };
}
