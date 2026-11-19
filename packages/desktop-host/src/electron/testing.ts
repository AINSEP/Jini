/** Fake Electron surfaces for tests — never a real `electron` import (see `electron-surfaces.ts`). */
import type {
  ElectronAppLike,
  ElectronBrowserWindowFactory,
  ElectronBrowserWindowLike,
  ElectronBrowserWindowOptions,
  ElectronDialogLike,
  ElectronOpenDialogResult,
  ElectronProtocolLike,
  ElectronShellLike,
  ElectronWebContentsLike,
} from './electron-surfaces.js';

export function createFakeElectronApp(_requiredArgs: Record<string, never>, options: { lockGranted?: boolean; recentDocuments?: string[] } = {}): ElectronAppLike & {
  quitCalled: boolean;
  emitSecondInstance(): void;
} {
  let secondInstanceListener: (() => void) | null = null;
  const recentDocuments = options.recentDocuments ?? [];
  const app = {
    quitCalled: false,
    requestSingleInstanceLock: () => options.lockGranted ?? true,
    quit() {
      app.quitCalled = true;
    },
    on({ listener }: { event: 'second-instance'; listener: () => void }) {
      secondInstanceListener = listener;
    },
    emitSecondInstance() {
      secondInstanceListener?.();
    },
    getRecentDocuments() {
      return recentDocuments;
    },
    addRecentDocument({ path }: { path: string }) {
      recentDocuments.unshift(path);
    },
  };
  return app;
}

export function createFakeElectronDialog(_requiredArgs: Record<string, never>, script: { openDialogResult?: ElectronOpenDialogResult } = {}): ElectronDialogLike & {
  lastShowOpenDialogOptions: unknown;
} {
  const fake = {
    lastShowOpenDialogOptions: undefined as unknown,
    async showOpenDialog(_requiredArgs: Record<string, never>, options: import('./electron-surfaces.js').ElectronOpenDialogOptions = {}) {
      fake.lastShowOpenDialogOptions = options;
      return script.openDialogResult ?? { canceled: true, filePaths: [] };
    },
  };
  return fake;
}

export interface FakeWindowScript {
  failLoad?: { errorCode: number; errorDescription: string };
  hang?: boolean;
  pdfResult?: Buffer;
  pngResult?: Buffer;
}

export function createFakeBrowserWindowFactory(_requiredArgs: Record<string, never>, script: FakeWindowScript = {}): {
  factory: ElectronBrowserWindowFactory;
  windows: ElectronBrowserWindowLike[];
} {
  const windows: ElectronBrowserWindowLike[] = [];

  const factory = (_requiredArgs: Record<string, never>, _options: ElectronBrowserWindowOptions = {}): ElectronBrowserWindowLike => createFakeBrowserWindow(script, windows);
  return { factory, windows };
}

function createFakeBrowserWindow(script: FakeWindowScript, windows: ElectronBrowserWindowLike[]): ElectronBrowserWindowLike {
  let destroyed = false;
  const closedListeners: Array<() => void> = [];
  const { webContents, loadURL, triggerBeforeRequest, triggerWillNavigate } = createFakeWindowContents(script);

  const win: ElectronBrowserWindowLike & { triggerBeforeRequest(url: string): { cancel: boolean }; triggerWillNavigate(url: string): boolean } = {
    webContents,
    loadURL,
    show() {},
    hide() {},
    focus() {},
    close() {
      win.destroy();
    },
    destroy() {
      destroyed = true;
      for (const listener of closedListeners) listener();
    },
    isDestroyed() {
      return destroyed;
    },
    on({ event, listener }) {
      if (event === 'closed') closedListeners.push(listener);
    },
    triggerBeforeRequest,
    triggerWillNavigate,
  };
  windows.push(win);
  return win;
}

function createFakeWindowContents(script: FakeWindowScript) {
  let didFinishLoad: (() => void) | null = null;
  let didFailLoad: ((args: { event: unknown; errorCode: number; errorDescription: string }) => void) | null = null;
  const navigation = createFakeWindowNavigation();

  const webContents: ElectronWebContentsLike = {
    session: {
      webRequest: {
        onBeforeRequest: navigation.onBeforeRequest,
      },
    },
    async loadURL() {},
    once({ event, listener }) {
      if (event === 'did-finish-load') didFinishLoad = listener as () => void;
      if (event === 'did-fail-load') didFailLoad = listener as (args: { event: unknown; errorCode: number; errorDescription: string }) => void;
    },
    on: navigation.on,
    async printToPDF() {
      return script.pdfResult ?? Buffer.from('pdf-bytes');
    },
    async capturePage() {
      const png = script.pngResult ?? Buffer.from('png-bytes');
      return { toPNG: () => png };
    },
  };

  return { webContents,
    async loadURL(_args: { url: string }) {
      if (script.hang === true) return;
      queueMicrotask(() => {
        if (script.failLoad != null) didFailLoad?.({ event: null, errorCode: script.failLoad.errorCode, errorDescription: script.failLoad.errorDescription });
        else didFinishLoad?.();
      });
    },
    triggerBeforeRequest: navigation.triggerBeforeRequest,
    triggerWillNavigate: navigation.triggerWillNavigate,
  };
}

function createFakeWindowNavigation() {
  let willNavigate: ((args: { event: { preventDefault(): void }; url: string }) => void) | null = null;
  let beforeRequest: ((args: { details: { url: string }; callback: (response: { cancel: boolean }) => void }) => void) | null = null;
  return {
    onBeforeRequest({ listener }: Parameters<ElectronWebContentsLike['session']['webRequest']['onBeforeRequest']>[0]) {
      beforeRequest = listener;
    },
    on({ event, listener }: Parameters<ElectronWebContentsLike['on']>[0]) {
      if (event === 'will-navigate') willNavigate = listener as (args: { event: { preventDefault(): void }; url: string }) => void;
    },
    triggerBeforeRequest(url: string) {
      let result: { cancel: boolean } = { cancel: false };
      beforeRequest?.({ details: { url }, callback: (response) => {
        result = response;
      } });
      return result;
    },
    triggerWillNavigate(url: string) {
      let prevented = false;
      willNavigate?.({ event: { preventDefault: () => (prevented = true) }, url });
      return prevented;
    },
  };
}

export function createFakeElectronProtocol(_requiredArgs: Record<string, never>): ElectronProtocolLike & { handlers: Map<string, (args: { request: Request }) => Promise<Response>> } {
  const handlers = new Map<string, (args: { request: Request }) => Promise<Response>>();
  return {
    handlers,
    registerSchemesAsPrivileged() {},
    handle({ scheme, handler }) {
      handlers.set(scheme, handler);
    },
  };
}

export function createFakeElectronShell(_requiredArgs: Record<string, never>, options: { openPathError?: string } = {}): ElectronShellLike & {
  openedExternalUrls: string[];
  openedPaths: string[];
} {
  const openedExternalUrls: string[] = [];
  const openedPaths: string[] = [];
  return {
    openedExternalUrls,
    openedPaths,
    async openExternal({ url }: { url: string }) {
      openedExternalUrls.push(url);
    },
    async openPath({ path }: { path: string }) {
      openedPaths.push(path);
      return options.openPathError ?? '';
    },
  };
}
