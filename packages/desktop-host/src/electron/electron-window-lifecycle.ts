import { withMainWindowTracking, type WindowCreateOptions, type WindowHandle, type WindowLifecyclePort } from '../window-lifecycle.js';
import type { ElectronBrowserWindowFactory } from './electron-surfaces.js';

function toWindowHandle(win: ReturnType<ElectronBrowserWindowFactory>): WindowHandle {
  return {
    async loadUrl({ url }) {
      await win.loadURL({ url });
    },
    show: () => win.show(),
    hide: () => win.hide(),
    focus: () => win.focus(),
    close: () => win.close(),
    isDestroyed: () => win.isDestroyed(),
    onClosed: ({ listener }) => win.on({ event: 'closed', listener }),
  };
}

export function createElectronWindowLifecyclePort({ createBrowserWindow }: { createBrowserWindow: ElectronBrowserWindowFactory }): WindowLifecyclePort {
  return withMainWindowTracking({ createWindowImpl: async (requiredArgs: Pick<WindowCreateOptions, 'url'>, optionalArgs: Omit<WindowCreateOptions, 'url'> = {}) => {
    const options = { ...optionalArgs, ...requiredArgs };
    const win = createBrowserWindow({}, {
      show: options.show ?? false,
      ...(options.width == null ? {} : { width: options.width }),
      ...(options.height == null ? {} : { height: options.height }),
    });
    const handle = toWindowHandle(win);
    await handle.loadUrl({ url: options.url });
    if (options.show ?? true) handle.show();
    return handle;
  } });
}
