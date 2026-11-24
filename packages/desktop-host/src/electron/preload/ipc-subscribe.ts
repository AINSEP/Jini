/** The raw `(event, payload)` callback Electron's `ipcRenderer.on` registers. */
export type PreloadIpcHandler = (event: unknown, payload: unknown) => void;

/**
 * The two `ipcRenderer` listener methods a preload subscriber needs, args-object shaped. The host
 * adapts Electron's positional `ipcRenderer.on(channel, handler)` / `removeListener(channel, handler)`
 * and must pass `handler` through unchanged: cleanup relies on removing that exact function.
 */
export interface PreloadIpcListenerPort {
  on(args: { channel: string; handler: PreloadIpcHandler }): unknown;
  removeListener(args: { channel: string; handler: PreloadIpcHandler }): unknown;
}

/** Subscribes one renderer listener to one main-to-renderer push channel; returns its teardown. */
export type PreloadSubscribe = <Payload>(
  args: { channel: string; listener: (payload: Payload) => void },
  _optional?: Record<string, unknown>,
) => () => void;

/**
 * Builds the preload's channel subscriber. The channel allowlist stays with the host: the host's
 * preload calls this only with its own fixed contract channels and never exposes it to the page.
 *
 * The raw `IpcRendererEvent` is dropped rather than forwarded: it carries `sender`, which is a live
 * handle into IPC that the page has no business holding, and returning the unsubscribe function is
 * what lets the renderer detach a pane without leaking a listener per remount.
 */
export function createPreloadSubscriber({ ipcRenderer }: { ipcRenderer: PreloadIpcListenerPort }, _optional = {}): PreloadSubscribe {
  return <Payload>({ channel, listener }: { channel: string; listener: (payload: Payload) => void }, _optional = {}) => {
    const handler: PreloadIpcHandler = (_event, payload) => listener(payload as Payload);
    ipcRenderer.on({ channel, handler });
    return () => {
      ipcRenderer.removeListener({ channel, handler });
    };
  };
}
