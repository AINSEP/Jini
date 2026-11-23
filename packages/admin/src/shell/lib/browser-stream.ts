/** Browser connection ownership; transport callbacks retain their native retry policy. */
import type { VisibilitySource } from "../../react/kit.js";
import type { StreamActivity } from "./stream-activity.js";
import { reportShellFailure } from "./shell-failure-log.js";

export interface StreamChannel {
  postMessage(value: unknown): void;
  addEventListener(kind: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(kind: "message", listener: (event: MessageEvent<unknown>) => void): void;
  close(): void;
}
export interface BrowserStreamPorts {
  visibility: VisibilitySource;
  page: {
    addEventListener(kind: "pagehide" | "pageshow", listener: () => void): void;
    removeEventListener(kind: "pagehide" | "pageshow", listener: () => void): void;
  };
  now(): number;
  schedule(required: { work: () => void; delayMs: number }): () => void;
  requestLock?: ((required: { key: string; signal: AbortSignal; hold: () => Promise<void> }) => Promise<unknown>) | undefined;
  openChannel?: ((required: { name: string }) => StreamChannel) | undefined;
  /** The host's guarded call (core `orFallbackSync`): a refused channel (storage-denied host) yields
   *  the fallback and is reported by the host, never thrown into the stream. */
  orFallbackSync: (required: { work: () => StreamChannel | undefined; fallback: undefined; step: string }) => StreamChannel | undefined;
}

/** Resolve browser capabilities at the adapter boundary, never during module import. The host
 *  supplies its guarded-call implementation; Jini constructs no default ports of its own. */
export function browserStreamPorts(
  { orFallbackSync }: { orFallbackSync: BrowserStreamPorts["orFallbackSync"] },
  _optional = {},
): BrowserStreamPorts {
  return {
    orFallbackSync,
    visibility: document,
    page: window,
    now: () => Date.now(),
    schedule: ({ work, delayMs }) => { const timer = setTimeout(work, delayMs); return () => clearTimeout(timer); },
    requestLock: typeof navigator.locks?.request === "function"
      ? ({ key, signal, hold }) => navigator.locks.request(key, { signal }, hold) : undefined,
    openChannel: typeof BroadcastChannel === "function" ? ({ name }) => new BroadcastChannel(name) : undefined,
  };
}

/** Unshared idle streams close after this long hidden; shared hidden leaders yield immediately. */
const HIDDEN_GRACE_MS = 30_000;

/**
 * Hold one connection per key/origin using Web Locks, broadcasting only serializable frames.
 * Tab-specific command streams use scope="tab": commands must execute on their bound page.
 * Shared hidden leaders yield immediately; unshared idle streams have a 30s grace period.
 * Active chat retains tab streams. Pagehide/disposal always releases locks and connections.
 * @returns Idempotent disposer. Transport construction errors propagate in per-tab mode.
 * @complexity O(1) ownership state per subscriber; channel delivery is O(number of tabs).
 * @example startBrowserStream({ key: "feed", connect: ({ emit }) => openFeed((frame) => emit({ frame })) });
 */
export function startBrowserStream<Frame>(
  { key, connect, receive = () => {} }: {
    key: string;
    connect: (required: { emit: (required: { frame: Frame }, optional?: Record<string, never>) => void }) => () => void;
    receive?: (required: { frame: Frame }) => void;
  },
  { ports, scope = "origin", activity }: {
    ports: BrowserStreamPorts; scope?: "origin" | "tab"; activity?: StreamActivity;
  },
): () => void {
  const state: BrowserStreamState = {
    disposed: false,
    away: false,
    hiddenSince: hiddenSinceNow({ ports, previous: undefined }),
    stopConnection: undefined,
    stopTimer: undefined,
    lock: undefined,
    releaseLock: undefined,
    channel: undefined,
  };
  // `stop` removes this listener, so a disposed stream never reaches it.
  const onMessage = (event: MessageEvent<unknown>) => {
    if (!state.away) receive({ frame: event.data as Frame });
  };
  state.channel = openSharedChannel({ key, scope, ports, onMessage });
  const halt = () => haltBrowserStream(state);
  const open = () => openBrowserStreamConnection<Frame>(state, { connect, receive });
  const acquire = () => acquireBrowserStreamLock(state, { key, ports }, { open, halt, closeChannel, reconcile });
  const closeChannel = () => closeBrowserStreamChannel(state, onMessage);
  const reconcile = () => reconcileBrowserStream(state, { halt, acquire, reconcileTab });
  const reconcileTab = () => reconcileTabStream(state, { ports, activity }, { halt, reconcile, open });

  const onVisibility = () => {
    state.hiddenSince = hiddenSinceNow({ ports, previous: state.hiddenSince });
    reconcile();
  };
  const onPageHide = () => { state.away = true; reconcile(); };
  const onPageShow = () => { state.away = false; onVisibility(); };
  ports.visibility.addEventListener("visibilitychange", onVisibility);
  ports.page.addEventListener("pagehide", onPageHide);
  ports.page.addEventListener("pageshow", onPageShow);
  const unsubscribeActivity = activity?.subscribe({ listener: reconcile });
  const stop = createBrowserStreamDisposer(state, { ports, onVisibility, onPageHide, onPageShow, unsubscribeActivity }, { halt, closeChannel });
  // A throwing first connect must not leave listeners or a lock behind; the error still propagates.
  let started = false;
  try { reconcile(); started = true; } finally { if (!started) stop(); }
  return stop;
}

interface BrowserStreamState {
  disposed: boolean;
  away: boolean;
  hiddenSince: number | undefined;
  stopConnection: (() => void) | undefined;
  stopTimer: (() => void) | undefined;
  lock: AbortController | undefined;
  releaseLock: (() => void) | undefined;
  channel: StreamChannel | undefined;
}

/** Close before releasing the lock: two tabs must never overlap their connections. */
function haltBrowserStream(state: BrowserStreamState): void {
    state.stopConnection?.();
    state.stopConnection = undefined;
    state.lock?.abort();
    state.lock = undefined;
    state.releaseLock?.();
    state.releaseLock = undefined;
  }


function openBrowserStreamConnection<Frame>(state: BrowserStreamState, { connect, receive }: Required<Pick<Parameters<typeof startBrowserStream<Frame>>[0], "connect" | "receive">>): void {
    if (state.stopConnection) return;
    let connected = true;
    const close = connect({ emit: ({ frame }, _optional = {}) => {
      if (!connected || state.disposed || state.away) return;
      receive({ frame });
      state.channel?.postMessage(frame);
    } });
    state.stopConnection = () => { connected = false; close(); };
  }

/** A pending/acquired lock owns its own cancellation; denied hosts switch to tab mode. */
function acquireBrowserStreamLock(state: BrowserStreamState, { key, ports }: { key: string; ports: BrowserStreamPorts }, { open, halt, closeChannel, reconcile }: { open: () => void; halt: () => void; closeChannel: () => void; reconcile: () => void }): void {
    if (state.lock) return;
    if (!ports.requestLock) throw new Error("shared browser stream has no lock provider");
    const requested = new AbortController();
    state.lock = requested;
    // Disposal and pagehide both run `halt()`, which aborts this request, so its signal covers them.
    void ports.requestLock({ key: `browser-stream:${key}`, signal: requested.signal, hold: async () => {
      if (requested.signal.aborted) return;
      // Set the release first so cleanup always releases even when connect throws.
      await new Promise<void>((resolve, reject) => {
        state.releaseLock = resolve;
        try { open(); } catch (error) { reject(error); }
      });
    } }).catch((error: unknown) => {
      // An abort is our own disposal/pagehide, not a failure; anything else (a refused or failed lock
      // request) goes to the host-bound logger, which owns redaction, before the per-tab fallback.
      if (requested.signal.aborted) return;
      reportShellFailure({ message: `[browser-stream] ${key}: the cross-tab lock was refused; falling back to a per-tab stream`, error });
      halt();
      closeChannel();
      reconcile();
    });
  }


function closeBrowserStreamChannel(state: BrowserStreamState, onMessage: (event: MessageEvent<unknown>) => void): void {
    state.channel?.removeEventListener("message", onMessage);
    state.channel?.close();
    state.channel = undefined;
  }

/** Reconcile one tab's visibility/activity with its connection and queued lock. */
function reconcileBrowserStream(state: BrowserStreamState, { halt, acquire, reconcileTab }: { halt: () => void; acquire: () => void; reconcileTab: () => void }): void {
    const stopTimer = state.stopTimer;
    stopTimer?.();
    state.stopTimer = undefined;
    if (state.disposed || state.away) { halt(); return; }
    if (state.channel) {
      if (state.hiddenSince !== undefined) { halt(); return; }
      acquire();
      return;
    }
    reconcileTab();
  }

/** Per-tab mode: keep the connection through the hidden grace period unless a chat is active. */
function reconcileTabStream(state: BrowserStreamState, { ports, activity }: { ports: BrowserStreamPorts; activity: StreamActivity | undefined }, { halt, reconcile, open }: { halt: () => void; reconcile: () => void; open: () => void }): void {
    if (state.hiddenSince !== undefined && !activity?.active({})) {
      const remaining = HIDDEN_GRACE_MS - (ports.now() - state.hiddenSince);
      if (remaining <= 0) { halt(); return; }
      state.stopTimer = ports.schedule({ work: reconcile, delayMs: remaining });
    }
    open();
  }

function createBrowserStreamDisposer(state: BrowserStreamState, { ports, onVisibility, onPageHide, onPageShow, unsubscribeActivity }: {
  ports: BrowserStreamPorts; onVisibility: () => void; onPageHide: () => void; onPageShow: () => void; unsubscribeActivity: (() => void) | undefined;
}, { halt, closeChannel }: { halt: () => void; closeChannel: () => void }): () => void {
  return () => {
    if (state.disposed) return;
    state.disposed = true;
    halt();
    const stopTimer = state.stopTimer;
    stopTimer?.();
    unsubscribeActivity?.();
    ports.visibility.removeEventListener("visibilitychange", onVisibility);
    ports.page.removeEventListener("pagehide", onPageHide);
    ports.page.removeEventListener("pageshow", onPageShow);
    closeChannel();
  };
}


/**
 * When the tab became hidden: kept while it stays hidden, cleared once visible.
 * @param required Ports to read visibility/clock from, and the previous hidden-since time.
 * @returns Hidden-since timestamp, or undefined while visible.
 */
function hiddenSinceNow({ ports, previous }: { ports: BrowserStreamPorts; previous: number | undefined }): number | undefined {
  return ports.visibility.visibilityState === "hidden" ? previous ?? ports.now() : undefined;
}

/**
 * Opens the cross-tab fan-out channel for an origin-scoped stream and starts listening on it.
 * @param required Stream key and scope, browser ports, and the frame listener.
 * @returns The channel, or undefined for tab scope, hosts lacking locks or channels, or a refused channel.
 */
function openSharedChannel(
  { key, scope, ports, onMessage }: {
    key: string; scope: "origin" | "tab"; ports: BrowserStreamPorts; onMessage: (event: MessageEvent<unknown>) => void;
  },
): StreamChannel | undefined {
  // Both capabilities are necessary: a lock without fan-out would silence follower tabs.
  if (scope !== "origin" || !ports.requestLock || !ports.openChannel) return undefined;
  const channel = ports.orFallbackSync({ work: () => ports.openChannel?.({ name: `browser-stream:${key}` }), fallback: undefined, step: "Open browser stream channel" });
  if (!channel) return undefined; // Storage-denied hosts use the visibility-managed fallback.
  channel.addEventListener("message", onMessage);
  return channel;
}
