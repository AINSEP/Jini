/**
 * @file The surface-side half of the admin-surface message protocol, for a plugin's own UI.
 *
 * Self-contained on purpose (no imports): a plugin's surface is plain static files, so it may import
 * this module from the package or copy the compiled file next to its entry. The constants repeat
 * `./protocol.ts`; the vertical-slice test proves the two still agree.
 *
 * Trust rules it applies: it accepts init only from its parent window (once), learns the host's
 * origin from that init and posts only to that origin (never "*"), and accepts a response only from
 * the parent, from that origin, for this mount, for a request it still has pending, in a valid shape.
 */

const PROTOCOL = 'jini.admin-surface';
const VERSION = 1;
const DEFAULT_TIMEOUT_MS = 30_000;

/** The parts of `window.parent` the client uses. */
export interface AdminSurfaceParentPort {
  postMessage(message: unknown, targetOrigin: string): void;
}
/** The fields of a `MessageEvent` the client reads. */
export interface AdminSurfaceIncomingMessage {
  readonly origin: string;
  readonly source: unknown;
  readonly data: unknown;
}
/** Subscribes to `message` events; returns the unsubscribe function. */
export type AdminSurfaceListenPort = (handler: (event: AdminSurfaceIncomingMessage) => void) => () => void;

export interface AdminSurfaceClientFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}
/** Rejection value of `call` when the host refused the action or the request timed out. */
export class AdminSurfaceCallError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(required: AdminSurfaceClientFailure) {
    super(required.message);
    this.name = 'AdminSurfaceCallError';
    this.code = required.code;
    this.retryable = required.retryable;
  }
}

interface Pending { resolve(value: unknown): void; reject(error: AdminSurfaceCallError): void; timer: ReturnType<typeof setTimeout> }
interface Init { readonly mountId: string; readonly origin: string; readonly bootstrap: unknown }
type Message = Readonly<Record<string, unknown>>;

function isMessage(data: unknown, kind: string): data is Message {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as Message;
  return message.protocol === PROTOCOL && message.version === VERSION && message.kind === kind;
}
function isFailure(value: unknown): value is AdminSurfaceClientFailure {
  if (typeof value !== 'object' || value === null) return false;
  const error = value as Message;
  return typeof error.code === 'string' && typeof error.message === 'string' && typeof error.retryable === 'boolean';
}
/** A response has `ok: true` with a result, or `ok: false` with a well-formed failure. */
function isWellFormedResponse(message: Message): boolean {
  return message.ok === true ? Object.hasOwn(message, 'result') : message.ok === false && isFailure(message.error);
}

/**
 * Connects a surface to its host. In a browser:
 * `createAdminSurfaceClient({ parent: window.parent, listen: (h) => { addEventListener('message', h); return () => removeEventListener('message', h); } })`.
 * @param optional.timeoutMs - How long `call` waits for a response before rejecting with `timeout`.
 * @complexity O(1) per message.
 */
export function createAdminSurfaceClient(
  required: { readonly parent: AdminSurfaceParentPort; readonly listen: AdminSurfaceListenPort },
  optional: { readonly timeoutMs?: number; readonly nowMs?: () => number } = {},
) {
  const timeoutMs = optional.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const nowMs = optional.nowMs ?? Date.now;
  const pending = new Map<string, Pending>();
  let init: Init | undefined;
  let nextRequest = 0;
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => { resolveReady = resolve; });

  function onInit(event: AdminSurfaceIncomingMessage, data: Message): void {
    if (init !== undefined || typeof data.mountId !== 'string') return;
    init = { mountId: data.mountId, origin: event.origin, bootstrap: data.bootstrap };
    resolveReady();
  }

  function onResponse(event: AdminSurfaceIncomingMessage, data: Message): void {
    if (event.origin !== init?.origin || data.mountId !== init.mountId || typeof data.requestId !== 'string') return;
    const waiting = pending.get(data.requestId);
    if (waiting === undefined || !isWellFormedResponse(data)) return;
    pending.delete(data.requestId);
    clearTimeout(waiting.timer);
    if (data.ok === true) waiting.resolve(data.result);
    else waiting.reject(new AdminSurfaceCallError(data.error as AdminSurfaceClientFailure));
  }

  const unsubscribe = required.listen((event) => {
    if (event.source !== required.parent) return;
    if (isMessage(event.data, 'init')) onInit(event, event.data);
    else if (isMessage(event.data, 'action-response')) onResponse(event, event.data);
  });

  /** Posts one request of `kind` to the host origin and waits for its `action-response`. */
  async function send(kind: string, fields: Readonly<Record<string, unknown>>): Promise<unknown> {
    if (init === undefined) await ready;
    const { mountId, origin } = init!;
    nextRequest += 1;
    const requestId = `r${nextRequest}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new AdminSurfaceCallError({ code: 'timeout', message: 'The host did not answer in time. Try again.', retryable: true }));
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
      required.parent.postMessage({ protocol: PROTOCOL, version: VERSION, kind, mountId, requestId, ...fields }, origin);
    });
  }

  /** Asks the host to run one declared action; resolves with its result. */
  function call(input: { readonly action: string; readonly payload: unknown }): Promise<unknown> {
    return send('action-request', { action: input.action, payload: input.payload });
  }

  /** Asks the host to open `url` outside the sandbox; only https links on the surface's declared
   * `linkOrigins` open, and the host decides how (new tab, system browser). Rejects with the host's refusal. */
  async function openLink(input: { readonly url: string }): Promise<void> {
    await send('open-link', { url: input.url });
  }

  /** The bootstrap `data` the host sent with init, or `undefined` once it has expired (or none was sent). */
  function bootstrap(): unknown {
    const envelope = init?.bootstrap;
    if (typeof envelope !== 'object' || envelope === null) return undefined;
    const { expiresAt, data } = envelope as Message;
    return typeof expiresAt === 'number' && nowMs() < expiresAt ? data : undefined;
  }

  /** Stops listening and rejects every pending call. */
  function close(): void {
    unsubscribe();
    for (const [requestId, waiting] of pending) {
      clearTimeout(waiting.timer);
      waiting.reject(new AdminSurfaceCallError({ code: 'closed', message: 'The surface was closed before the host answered.', retryable: false }));
      pending.delete(requestId);
    }
  }

  return { ready, call, openLink, bootstrap, close };
}
