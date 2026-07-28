/**
 * `RealtimeProvider` — a swappable pub/sub port (live updates pushed to
 * subscribers). Speculative port-design exploration (see `source-map.md`) —
 * no OD source; named in `foundry/docs/jini-port/recon/r5b-consumers-matrix.md` §3.3
 * as part of the Zana/Tovu-convergent capability set (Supabase Realtime is
 * Zana's reference adapter).
 *
 * This file defines the port's stable interface/type surface, plus one real,
 * production-quality adapter (`WebSocketRealtimeProvider` +
 * `createWebSocketRealtimeProvider`, added 2026-07-21 — see
 * `source-map.md`'s dated section) using WebSockets (the `ws` package) — no
 * external hosted-realtime-service dependency (no Pusher/Ably/Supabase
 * Realtime). The in-memory reference implementation
 * (`createInMemoryRealtimeProvider`) is a separate, non-production stub that
 * lives under `src/unsafe-reference/`, exported only from the separate
 * `@injini/capability-providers/unsafe-reference` entry point — see that
 * directory's `index.ts` header for the full warning.
 */
import { WebSocketServer, type ServerOptions } from 'ws';

export type RealtimeHandler<T = unknown> = (event: T) => void;

/** Call to stop receiving events for the subscription that returned it. Idempotent. */
export type RealtimeUnsubscribe = () => void;

export interface RealtimeProvider {
  /** Delivers `event` synchronously to every current subscriber of `channel`. Resolves once all handlers have run. */
  publish<T>(channel: string, event: T): Promise<void>;
  /** Registers `handler` for every future `publish` on `channel`. Returns an unsubscribe function. */
  subscribe<T>(channel: string, handler: RealtimeHandler<T>): RealtimeUnsubscribe;
}

/** WebSocket `readyState` value meaning "open and ready to communicate" (WHATWG WebSocket spec; `ws`'s `WebSocket.OPEN` is the same constant `1`). Spelled out locally so `WebSocketRealtimeProvider`'s core class has no runtime import of `ws` — only the `RealtimeWebSocketLike`/`RealtimeWebSocketServerLike` structural types below, and the `createWebSocketRealtimeProvider` factory, actually touch the real package. */
const WEBSOCKET_OPEN_STATE = 1;

/**
 * The minimal structural subset of a `ws` `WebSocket` connection this adapter depends on. A real
 * `ws.WebSocket` instance satisfies this without any adaptation; tests construct a plain fake
 * (an `EventEmitter`-backed object) satisfying the same shape, so `WebSocketRealtimeProvider`'s
 * core logic is fully unit-testable with zero real sockets/ports.
 */
export interface RealtimeWebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  on(event: 'message', listener: (data: unknown) => void): void;
  on(event: 'close', listener: () => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
}

/** The minimal structural subset of a `ws` `WebSocketServer` this adapter depends on. */
export interface RealtimeWebSocketServerLike {
  on(event: 'connection', listener: (socket: RealtimeWebSocketLike) => void): void;
}

export interface WebSocketRealtimeProviderOptions {
  /** The (real or fake) WebSocket server to accept subscriber connections from. */
  readonly server: RealtimeWebSocketServerLike;
}

interface ClientMessage {
  readonly type: 'subscribe' | 'unsubscribe';
  readonly channel: string;
}

/** Parses one inbound client message. Returns `null` for anything not shaped like `{type: 'subscribe'|'unsubscribe', channel: string}` — malformed/unrecognized messages are silently ignored rather than closing the connection, matching a pub/sub transport's normal tolerance for unknown message shapes (e.g. a future protocol version). */
function parseClientMessage(raw: unknown): ClientMessage | null {
  let text: string;
  if (typeof raw === 'string') {
    text = raw;
  } else if (Buffer.isBuffer(raw)) {
    text = raw.toString('utf8');
  } else if (raw instanceof ArrayBuffer) {
    text = Buffer.from(raw).toString('utf8');
  } else {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if ((obj.type !== 'subscribe' && obj.type !== 'unsubscribe') || typeof obj.channel !== 'string') return null;
  return { type: obj.type, channel: obj.channel };
}

/**
 * `RealtimeProvider` adapter using WebSockets: a self-contained pub/sub server, no external
 * hosted-realtime-service dependency. Two subscriber shapes fan out from the same `publish()`:
 *
 * 1. **In-process** subscribers registered via `subscribe()` — called synchronously, exactly
 *    like the in-memory reference adapter (same handler-Set-per-channel bookkeeping).
 * 2. **Remote WebSocket clients** — connect through the injected server, then send
 *    `{"type":"subscribe","channel":"..."}` / `{"type":"unsubscribe","channel":"..."}` JSON
 *    messages to opt in/out of channels. `publish()` sends each currently-subscribed, still-open
 *    socket a `{"type":"event","channel":"...","event":...}` JSON message. A closed connection is
 *    cleaned out of every channel it was subscribed to.
 *
 * The constructor takes a `RealtimeWebSocketServerLike` — structurally satisfied by a real
 * `ws.WebSocketServer` (see `createWebSocketRealtimeProvider` below) or, in tests, a fake with no
 * real socket/port — so the channel-routing/subscription-bookkeeping core here is fully
 * unit-testable without any real network I/O.
 */
export class WebSocketRealtimeProvider implements RealtimeProvider {
  private readonly handlersByChannel = new Map<string, Set<RealtimeHandler>>();
  private readonly socketsByChannel = new Map<string, Set<RealtimeWebSocketLike>>();

  constructor(options: WebSocketRealtimeProviderOptions) {
    options.server.on('connection', (socket) => this.handleConnection(socket));
  }

  private handleConnection(socket: RealtimeWebSocketLike): void {
    const subscribedChannels = new Set<string>();

    socket.on('message', (raw) => {
      const message = parseClientMessage(raw);
      if (!message) return;
      if (message.type === 'subscribe') {
        subscribedChannels.add(message.channel);
        this.socketsFor(message.channel).add(socket);
      } else {
        subscribedChannels.delete(message.channel);
        this.socketsByChannel.get(message.channel)?.delete(socket);
      }
    });

    socket.on('close', () => {
      for (const channel of subscribedChannels) {
        this.socketsByChannel.get(channel)?.delete(socket);
      }
    });

    // Swallow — `ws` always follows an 'error' with a 'close' for the same socket, which already
    // performs the subscription cleanup above; there is nothing additional to do here.
    socket.on('error', () => {});
  }

  private socketsFor(channel: string): Set<RealtimeWebSocketLike> {
    let sockets = this.socketsByChannel.get(channel);
    if (!sockets) {
      sockets = new Set();
      this.socketsByChannel.set(channel, sockets);
    }
    return sockets;
  }

  private handlersFor(channel: string): Set<RealtimeHandler> {
    let handlers = this.handlersByChannel.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.handlersByChannel.set(channel, handlers);
    }
    return handlers;
  }

  async publish<T>(channel: string, event: T): Promise<void> {
    const handlers = this.handlersByChannel.get(channel);
    if (handlers) {
      for (const handler of [...handlers]) handler(event);
    }

    const sockets = this.socketsByChannel.get(channel);
    if (sockets && sockets.size > 0) {
      const payload = JSON.stringify({ type: 'event', channel, event });
      for (const socket of [...sockets]) {
        if (socket.readyState === WEBSOCKET_OPEN_STATE) socket.send(payload);
      }
    }
  }

  subscribe<T>(channel: string, handler: RealtimeHandler<T>): RealtimeUnsubscribe {
    const handlers = this.handlersFor(channel);
    handlers.add(handler as RealtimeHandler);
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      handlers.delete(handler as RealtimeHandler);
    };
  }
}

export interface CreateWebSocketRealtimeProviderOptions {
  /** Passed straight through to `ws`'s `WebSocketServer` constructor — e.g. `{ port: 8080 }` to listen standalone, or `{ server: httpServer }`/`{ noServer: true }` to share an existing HTTP server's upgrade handling. */
  readonly wsOptions: ServerOptions;
}

/** The real, production entry point: constructs an actual `ws.WebSocketServer` and wires a `WebSocketRealtimeProvider` to it. Callers that want to inject a fake server for tests should construct `WebSocketRealtimeProvider` directly instead. */
export function createWebSocketRealtimeProvider(
  options: CreateWebSocketRealtimeProviderOptions,
): { readonly provider: WebSocketRealtimeProvider; readonly server: WebSocketServer } {
  const server = new WebSocketServer(options.wsOptions);
  const provider = new WebSocketRealtimeProvider({ server });
  return { provider, server };
}
