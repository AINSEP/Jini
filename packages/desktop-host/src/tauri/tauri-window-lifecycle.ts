import { withMainWindowTracking, type WindowCreateOptions, type WindowHandle, type WindowLifecyclePort } from '../window-lifecycle.js';
import type { TauriWindowFactory, TauriWindowLike } from './tauri-surfaces.js';

let windowLabelCounter = 0;
function nextWindowLabel(): string {
  windowLabelCounter += 1;
  return `jini-desktop-host-${windowLabelCounter}`;
}

function toWindowHandle(win: TauriWindowLike): WindowHandle {
  return {
    async loadUrl({ url }) {
      await win.navigate({ url });
    },
    show: () => void win.show(),
    hide: () => void win.hide(),
    focus: () => void win.setFocus(),
    close: () => void win.close(),
    isDestroyed: () => win.isClosed(),
    onClosed: ({ listener }) => {
      if (win.onClosed != null) return win.onClosed({ listener });
      // Legacy bindings expose only a cancelable request. Observe confirmed closure instead;
      // a request can be prevented, or its native destruction can complete asynchronously.
      const observeClosed = () => {
        if (win.isClosed()) {
          listener();
          return;
        }
        const timer = setTimeout(observeClosed, 50);
        timer.unref?.();
      };
      observeClosed();
    },
  };
}

export function createTauriWindowLifecyclePort({ createTauriWindow }: { createTauriWindow: TauriWindowFactory }): WindowLifecyclePort {
  return withMainWindowTracking({ createWindowImpl: async (requiredArgs: Pick<WindowCreateOptions, 'url'>, optionalArgs: Omit<WindowCreateOptions, 'url'> = {}) => {
    const options = { ...optionalArgs, ...requiredArgs };
    const win = await createTauriWindow({ label: nextWindowLabel(), url: options.url }, {
      visible: options.show ?? true,
      ...(options.width == null ? {} : { width: options.width }),
      ...(options.height == null ? {} : { height: options.height }),
    });
    const handle = toWindowHandle(win);
    // Redundant with the `url` passed to createTauriWindow above (Tauri's
    // real WebviewWindow constructor loads it immediately) but explicit,
    // so WindowHandle.loadUrl is a real, exercised "URL load" capability
    // matching the Electron adapter's shape rather than a dead method.
    await handle.loadUrl({ url: options.url });
    return handle;
  } });
}
