/** EventSource-compatible page transport, with ownership delegated to browser-stream. */
import { startBrowserStream, type BrowserStreamPorts } from "./browser-stream.js";
import { adminStreamActivity, type StreamActivity } from "./stream-activity.js";

type Source = Pick<EventSource, "addEventListener" | "close" | "readyState">;

/** Message-bearing frames retain their cursor and origin; lifecycle events remain plain events. */
function forwardedTabEvent({ kind, message }: { kind: "message" | "error" | "open" | "parked"; message: MessageEvent<string> }): Event {
  return kind === "message" || kind === "parked"
    ? new MessageEvent(kind, { data: message.data, lastEventId: message.lastEventId, origin: message.origin })
    : new Event(kind);
}

/**
 * Preserve the bridge's EventSource contract across idle close/reopen, including native errors.
 * Visibility pauses emit `suspended` to clear the token while retaining the visibility owner.
 * Named `parked` events let the bridge close this facade until an explicit wake/rebind.
 * Message/command frames remain local: rebroadcasting them could click another tab's page.
 * @returns A disposable EventSource facade; native sources retain their own reconnect/backoff.
 * @complexity O(1) state and four listeners per live source.
 */
export function openTabEventSource(
  { url }: { url: string },
  { open = (url: string): Source => new EventSource(url), ports, activity = adminStreamActivity }: {
    open?: (url: string) => Source; ports?: BrowserStreamPorts; activity?: StreamActivity;
  } = {},
): EventSource {
  const state = {
    source: undefined as Source | undefined,
    disposed: false,
  };
  class ManagedSource extends EventTarget implements EventSource {
    // EventTarget already supports these listeners; expose EventSource's typed event overloads.
    readonly addEventListener = super.addEventListener.bind(this) as EventSource["addEventListener"];
    readonly removeEventListener = super.removeEventListener.bind(this) as EventSource["removeEventListener"];
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSED = 2;
    readonly url = url;
    readonly withCredentials = false;
    onerror: EventSource["onerror"] = null;
    onmessage: EventSource["onmessage"] = null;
    onopen: EventSource["onopen"] = null;
    get readyState(): number { return state.disposed ? 2 : state.source?.readyState ?? 0; }
    close(): void {
      if (state.disposed) return;
      state.disposed = true;
      stop();
    }
  }
  const managed = new ManagedSource();
  // Assigned before `managed` is returned, so no caller can reach `close()` while it is unset.
  const stop = startBrowserStream({ key: url, connect: createTabSourceConnector({ open, url, state, managed }) }, { ...(ports ? { ports } : {}), scope: "tab", activity });
  return managed;
}

function createTabSourceConnector({ open, url, state, managed }: { open: (url: string) => Source; url: string; state: { source: Source | undefined; disposed: boolean; }; managed: EventSource }) {
  return () => {
    const current = open(url);
    state.source = current;
    for (const kind of ["message", "error", "open", "parked"] as const) {
      current.addEventListener(kind, (event) => {
        if (state.source !== current || state.disposed) return;
        const message = event as MessageEvent<string>;
        const forwarded = forwardedTabEvent({ kind, message });
        managed.dispatchEvent(forwarded);
        if (kind === "message") managed.onmessage?.call(managed, forwarded as MessageEvent);
        else if (kind === "error") managed.onerror?.call(managed, forwarded);
        else if (kind === "open") managed.onopen?.call(managed, forwarded);
      });
    }
    return () => {
      state.source = undefined;
      current.close();
      // The daemon revokes its token on close. Clear the bridge's copy before another run starts.
      if (!state.disposed) {
        managed.dispatchEvent(new Event("suspended"));
      }
    };
  };
}
