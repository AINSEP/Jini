/**
 * @file `createAdminHttp` — the host session client: one JSON fetch seam with a request deadline,
 * session-invalidation notice, one retry after a server restart, and a final failure notice.
 *
 * Two transports live in this package on purpose. `createHttpTransport` (`core/transport/http.ts`)
 * is the route-group `AdminTransport`: neutral copy, `AdminApiError`, no retry. This factory is what
 * a host's own screens call through: it owns no error class (every error comes from the host's
 * `createError` port), no copy (`messages` port), and no failure vocabulary (`reportFailure` port).
 * The fetch-rejection classification, header merge, body parsing and envelope rule are the
 * transport's own stages, imported here, so each rule has one body.
 *
 * Every instance keeps its own upstream-refused marks; two factories never share state.
 */
import type { AdminHttpError, AdminHttpOptions, AdminHttpReconnect } from "@jini-ai/core/admin-runtime";
import {
  API_UNREACHABLE_CODE,
  REQUEST_TIMEOUT_CODE,
  lacksAppEnvelope,
  mergeHeaders,
  parseJsonBody,
  throwTranslatedFetchFailure,
} from "../../../core/transport/http.js";

type Empty = Record<string, never>;

/** Everything host-specific the client needs. Required: there are no fallback bindings. */
export interface CreateAdminHttpPorts<E extends AdminHttpError, B extends string, F extends string> {
  fetch(required: { url: string; init: RequestInit }, optional?: Empty): Promise<Response>;
  timeoutSignal(required: { ms: number }, optional?: Empty): AbortSignal;
  isPageUnloading(required: Empty, optional?: Empty): boolean;
  resolveBasePath(required: { basePath?: B | undefined }, optional?: Empty): string;
  /** The dev proxy's mark that the API refused the connection: the request never arrived. */
  isUpstreamRefused(required: { response: Response }, optional?: Empty): boolean;
  decodeApiError(required: { body: unknown }, optional?: { fallbackMessage?: string }): { message: string; code?: string | undefined };
  createError(
    required: { message: string; status: number },
    optional?: { code?: string | undefined; body?: Record<string, unknown> },
  ): E;
  isRequestError(required: { error: unknown }, optional?: Empty): required is { error: E };
  messages: {
    timeout(required: { ms: number }, optional?: Empty): string;
    unreachable(required: { status?: number }, optional?: Empty): string;
    /** `optional.headers` are the failed response's, so a host can name its own request/error id header. */
    requestFailed(required: { method: string; path: string; status: number }, optional?: { headers?: Headers }): string;
  };
  reconnect: AdminHttpReconnect;
  shouldRetry(required: {
    code: string | undefined; unreachableCode: string; method: string | undefined;
    upstreamRefused: boolean; retryWrites: boolean;
  }, optional?: Empty): boolean;
  /** A real session invalidation arrived: reset failure state, then notify session listeners. */
  sessionInvalidated(required: Empty, optional?: Empty): void;
  getFailureGeneration(required: Empty, optional?: Empty): number;
  /** Classify and publish one final failure. The client swallows anything this throws. */
  reportFailure(required: {
    error: E; path: string; method: string; generation: number; basePath: string; failureEntry?: F;
  }, optional?: Empty): void;
}

export interface CreateAdminHttpArgs<E extends AdminHttpError, B extends string, F extends string> {
  ports: CreateAdminHttpPorts<E, B, F>;
  /** How long a request may go unanswered when the caller supplies no signal. */
  timeoutMs: number;
}

type OnOk = (required: { response: Response }, optional?: Empty) => void;

/** The bound operations, in the shapes a host's existing callers already use. */
export interface AdminHttp<E extends AdminHttpError, B extends string, F extends string> {
  fetchOrThrowUnreachable(required: { url: string; init: RequestInit }, optional?: Empty): Promise<Response>;
  requestOnce<T>(required: { path: string; init?: RequestInit | undefined; onOk?: OnOk | undefined }, options?: AdminHttpOptions<E, B, F>): Promise<T>;
  requestRidingOutRestart<T>(
    required: { send: () => Promise<T>; method: string | undefined },
    optional?: { retryWrites?: boolean; reconnect?: AdminHttpReconnect },
  ): Promise<T>;
  request<T>(
    required: { path: string },
    optional?: { init?: RequestInit | undefined; onOk?: OnOk | undefined; options?: AdminHttpOptions<E, B, F> },
  ): Promise<T>;
  authenticatedAdminRequest<T>(
    required: { path: string; method: string; body?: unknown },
    options?: AdminHttpOptions<E, B, F>,
  ): Promise<T>;
}

interface Context<E extends AdminHttpError, B extends string, F extends string> {
  readonly ports: CreateAdminHttpPorts<E, B, F>;
  readonly timeoutMs: number;
  /** Errors the dev proxy proved never reached the server. Per instance. */
  readonly upstreamRefused: WeakSet<object>;
}

/**
 * Builds one client. Call it once per host; each call is an independent instance.
 *
 * @complexity O(1); each bound operation is O(1) plus its request and body parse.
 */
export function createAdminHttp<E extends AdminHttpError, B extends string, F extends string>(
  { ports, timeoutMs }: CreateAdminHttpArgs<E, B, F>,
  _optional: Empty = {},
): AdminHttp<E, B, F> {
  const ctx: Context<E, B, F> = { ports, timeoutMs, upstreamRefused: new WeakSet<object>() };
  const requestOnce: AdminHttp<E, B, F>["requestOnce"] = (required, options = {}) => sendOnce(ctx, required, options);
  const requestRidingOutRestart: AdminHttp<E, B, F>["requestRidingOutRestart"] = (required, optional = {}) =>
    rideOutRestart(ctx, required, optional);
  const request: AdminHttp<E, B, F>["request"] = (required, optional = {}) => sendReported(ctx, required, optional);
  return {
    fetchOrThrowUnreachable: (required, _optional: Empty = {}) => fetchBounded(ctx, required),
    requestOnce,
    requestRidingOutRestart,
    request,
    authenticatedAdminRequest: (required, options = {}) => {
      const payload = requestPayload({ body: required.body });
      return sendReported(ctx, { path: required.path }, { init: {
        method: required.method,
        ...payload,
        headers: { ...payload.headers, ...options.headers },
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.keepalive === undefined ? {} : { keepalive: options.keepalive }),
      }, onOk: options.onOk, options });
    },
  };
}

/** `fetch` with a deadline; a rejection becomes the host's timeout or unreachable error. */
async function fetchBounded<E extends AdminHttpError, B extends string, F extends string>(
  { ports, timeoutMs }: Context<E, B, F>,
  { url, init }: { url: string; init: RequestInit },
): Promise<Response> {
  // A caller's signal owns cancellation and its own deadline; never replace it with ours.
  const signal = init.signal ?? ports.timeoutSignal({ ms: timeoutMs });
  try {
    return await ports.fetch({ url, init: { ...init, signal } });
  } catch (cause) {
    return throwTranslatedFetchFailure({
      cause,
      timeoutError: ({ cause: timeout }) => ports.createError({ message: ports.messages.timeout({ ms: timeoutMs }), status: 0 }, {
        code: REQUEST_TIMEOUT_CODE, body: { cause: timeout instanceof Error ? timeout.message : String(timeout) },
      }),
      unreachableError: ({ cause: network }) => ports.createError({ message: ports.messages.unreachable({}), status: 0 }, {
        code: API_UNREACHABLE_CODE, body: { cause: network.message },
      }),
    }, { isPageUnloading: () => ports.isPageUnloading({}) });
  }
}

/**
 * `fetch`'s init with the session defaults under the caller's: same-origin cookies and a JSON
 * `Content-Type`. `init.headers` merges onto the default rather than replacing it, so one custom
 * header (an `If-Match`) never drops the type; a caller's own `Content-Type`, in any letter case,
 * wins outright, since two values would be sent joined with a comma. The merge is the transport's
 * `mergeHeaders`, so every `HeadersInit` form (Headers, tuples, record) is read the same way.
 *
 * @complexity O(h) in the caller's header count.
 */
export function buildFetchInit(
  { init = {} }: { readonly init?: RequestInit | undefined },
  _optional: Empty = {},
): RequestInit {
  return { credentials: "same-origin", ...init, headers: mergeHeaders({ sources: [init.headers] }) };
}

/** One send, no restart retry. A non-2xx throws the host's error; `onOk` runs just before resolve. */
async function sendOnce<T, E extends AdminHttpError, B extends string, F extends string>(
  ctx: Context<E, B, F>,
  { path, init, onOk }: { path: string; init?: RequestInit | undefined; onOk?: OnOk | undefined },
  options: AdminHttpOptions<E, B, F>,
): Promise<T> {
  const { ports } = ctx;
  const url = `${ports.resolveBasePath({ basePath: options.basePath })}${path}`;
  const res = await fetchBounded(ctx, { url, init: buildFetchInit({ init }) });
  const { body, wasUnparseable } = await parseJsonBody({ response: res }, { requireJson: res.ok && options.requireJson });
  if (!res.ok) throw failedResponseError(ctx, { res, body, wasUnparseable, method: init?.method ?? "GET", path }, options);
  onOk?.({ response: res });
  return body as T;
}

/** The non-2xx side effects, in order: session invalidation, the caller's error factory, the refused mark. */
function failedResponseError<E extends AdminHttpError, B extends string, F extends string>(
  ctx: Context<E, B, F>,
  { res, body, wasUnparseable, method, path }: { res: Response; body: Record<string, unknown>; wasUnparseable: boolean; method: string; path: string },
  options: AdminHttpOptions<E, B, F>,
): E {
  const { ports } = ctx;
  // Only a 401 carrying UNAUTHENTICATED invalidates the session: a relayed vendor 401 does not.
  if (res.status === 401 && ports.decodeApiError({ body }).code === "UNAUTHENTICATED") ports.sessionInvalidated({});
  const defaultError = responseError(ctx, { status: res.status, body, wasUnparseable, method, path, headers: res.headers });
  const error = options.errorFactory?.({ response: res, error: defaultError }) ?? defaultError;
  if (ports.isUpstreamRefused({ response: res })) ctx.upstreamRefused.add(error);
  return error;
}

/**
 * The error for a non-2xx response. An application's own JSON message wins; an unparseable 5xx
 * (a proxy with nothing listening, or a crash outside the JSON envelope) gets the unreachable
 * copy and code; any other empty error names the request and its status.
 */
function responseError<E extends AdminHttpError, B extends string, F extends string>(
  { ports }: Context<E, B, F>,
  { status, body, wasUnparseable, method, path, headers }: {
    status: number; body: Record<string, unknown>; wasUnparseable: boolean; method: string; path: string; headers: Headers;
  },
): E {
  const noAppEnvelope = lacksAppEnvelope({ status, wasUnparseable });
  const fallbackMessage = noAppEnvelope ? ports.messages.unreachable({ status }) : ports.messages.requestFailed({ method, path, status }, { headers });
  const decoded = ports.decodeApiError({ body }, { fallbackMessage });
  return ports.createError({ message: decoded.message, status }, { code: noAppEnvelope ? API_UNREACHABLE_CODE : decoded.code, body });
}

/**
 * Sends once; if the server was unreachable (a restart), waits for it to answer and sends exactly
 * once more. Reads always retry; writes only when provably undelivered or `retryWrites`.
 */
async function rideOutRestart<T, E extends AdminHttpError, B extends string, F extends string>(
  { ports, upstreamRefused }: Context<E, B, F>,
  { send, method }: { send: () => Promise<T>; method: string | undefined },
  { retryWrites = false, reconnect = ports.reconnect }: { retryWrites?: boolean; reconnect?: AdminHttpReconnect },
): Promise<T> {
  try {
    const result = await send();
    reconnect.markReachable();
    return result;
  } catch (error) {
    // The predicate narrows the named object, so read the typed error back from it.
    const failure = { error };
    const retry = ports.isRequestError(failure) && ports.shouldRetry({
      code: failure.error.code, unreachableCode: API_UNREACHABLE_CODE, method, upstreamRefused: upstreamRefused.has(failure.error), retryWrites,
    });
    if (!retry || !(await reconnect.waitUntilReachable())) throw error;
    return send();
  }
}

/**
 * One request riding out a restart; only the FINAL failure is reported. The generation is read
 * before sending so an older session's response cannot restore cleared notices.
 */
async function sendReported<T, E extends AdminHttpError, B extends string, F extends string>(
  ctx: Context<E, B, F>,
  { path }: { path: string },
  { init, onOk, options = {} }: { init?: RequestInit | undefined; onOk?: OnOk | undefined; options?: AdminHttpOptions<E, B, F> },
): Promise<T> {
  const { ports } = ctx;
  const generation = ports.getFailureGeneration({});
  const method = init?.method ?? "GET";
  const retryOptions = options.retryWrites === undefined ? {} : { retryWrites: options.retryWrites };
  try {
    return await rideOutRestart(ctx, { send: () => sendOnce<T, E, B, F>(ctx, { path, init, onOk }, options), method }, retryOptions);
  } catch (error) {
    const failure = { error };
    if (ports.isRequestError(failure)) {
      const basePath = ports.resolveBasePath({ basePath: options.basePath });
      const entry = options.failureEntry === undefined ? {} : { failureEntry: options.failureEntry };
      // Notice effects must never replace the caller's original rejection.
      try { ports.reportFailure({ error: failure.error, path, method, generation, basePath, ...entry }); } catch { /* keep the rejection */ }
    }
    throw error;
  }
}

/** The fetch init fragment for a body: none, a raw Blob with its own type, or JSON. */
function requestPayload({ body }: { body: unknown }, _optional: Empty = {}): { body?: BodyInit; headers?: Record<string, string> } {
  if (body === undefined) return {};
  if (body instanceof Blob) return { body, headers: { "Content-Type": body.type || "application/octet-stream" } };
  return { body: JSON.stringify(body) };
}
