/**
 * @module model-proxy
 *
 * `POST /api/proxy/{anthropic,openai,azure,google,ollama}/stream`, plus a
 * generic `POST /api/proxy/:provider/stream` catch-all — thin SSE route
 * wrappers over `@jini-ai/agent-runtime`'s `run{Anthropic,OpenAi,Azure,Google,
 * Ollama}ToolTurn` wire-adapter/turn-runners. Implements the placement
 * decision in `ADS-memory/reports/proposals/
 * PROP-http-route-packs-chat-model-proxy-2026-07-21.md`: OD's
 * `apps/daemon/src/routes/chat.ts` (2267 lines) genuinely is the largest
 * reusable route pack this package's routes-classification table ever
 * found, but its provider-specific wire-protocol knowledge (Anthropic
 * Messages API / OpenAI Chat Completions SSE parsing, tool-call-fragment
 * accumulation, the role-marker-guard contamination loop) does not belong
 * in generic HTTP transport. The provider-specific implementation stays in
 * the runtime, following the proposal to extend `@jini-ai/agent-runtime`'s existing `providers/` pattern instead.
 * This module is the `@jini-ai/daemon/http` transport half of that split: request parsing,
 * same-origin enforcement, and SSE transport (core's SSE stream, the same primitive
 * `runs.ts`/`memory.ts` already consume) — no knowledge of what an
 * Anthropic `content_block_delta`, an OpenAI `tool_calls[].function.
 * arguments` fragment, or a Gemini `candidates[0].content.parts[]` entry
 * looks like lives here.
 *
 * **2026-07-21 pass**: Anthropic and OpenAI only, per the proposal's own
 * phased recommendation ("the two most-used... deferring Azure/Google/
 * Ollama as mechanical repeats once the pattern is proven").
 *
 * **2026-07-22 pass (this addition)**: picks up exactly that deferred item
 * — Azure, Google, and Ollama proxy routes are now built, each a thin
 * sibling `registerProxyStreamRoute` call following the identical request-
 * parsing/SSE-wiring shape, once `@jini-ai/agent-runtime` grew the matching
 * per-vendor turn-runner (see that package's `archived provenance ledger`'s own
 * 2026-07-22 dated section). Also adds the generic `POST
 * /api/proxy/:provider/stream` catch-all described below.
 *
 * **OpenRouter is still not built — open, not rejected.** Evaluated as part
 * of the OD route-parity audit this pass drew on; the user wants to discuss
 * OpenRouter's specific placement (gateway vs. native-provider shape) further
 * before it gets ported. Flagged here explicitly, the same way the
 * 2026-07-21 pass flagged Azure/Google/Ollama, so it isn't mistaken for a
 * decision that's already been made either way.
 *
 * **Deliberately excluded regardless of this decision** (confirmed
 * OD-PRODUCT per the proposal): `POST /api/runs/:id/feedback` and the two
 * "Critique Theater" routes. Not touched by this module at all.
 *
 * **BYOK, not server-held credentials.** Every request carries its own
 * `apiKey` (and optional `baseUrl`/`extraHeaders`) in the POST body, exactly
 * like `@jini-ai/agent-runtime`'s existing `providers/model-catalog.ts` BYOK
 * surface — this route never stores or reads a server-side credential.
 * `apiKey` is required for all five providers, including Ollama — an earlier
 * version of this module made it optional for Ollama on a "local install
 * needs no auth" rationale that a live comparison against a running Open
 * Design daemon proved doesn't match OD's real behavior (OD's default
 * Ollama target is Ollama Cloud, which does require a key; see
 * `@jini-ai/agent-runtime`'s `ollama-chat.ts` module doc for the full
 * corrected design).
 *
 * **Tool execution is out of scope for this pass.** `ModelProxyHttpDeps`'s
 * `executeTool` hooks are optional and default to unset, matching
 * `f0a771d88^:packages/deploy/source-map.md`'s precedent for "deferred real
 * `ToolExecutor` wiring." With no executor supplied, a turn still streams
 * back any `tool_use`/`tool_calls` the model requests (so a caller can act
 * on them itself and start a fresh request with the results appended to
 * `messages`) — the turn-runner just does not attempt the server-side
 * tool-execution loop. See `anthropic-messages.ts`/`openai-chat.ts`'s own
 * docs for that behavior.
 *
 * **The `:provider` catch-all's relationship to the five fixed routes.**
 * `modelProxyRoutes` lists the five literal-path routes and the generic
 * `/api/proxy/:provider/stream` catch-all. The route table matches a literal
 * segment before a `:name` segment, whatever the list order, so a request to
 * `/api/proxy/anthropic/stream` (etc.) is always served by its own fixed,
 * strongly-typed handler — the catch-all's own lookup-table entry for
 * `'anthropic'` is real, tested code, but is only reachable via real HTTP
 * traffic for a provider name that has no dedicated fixed route (a typo, or
 * a future provider added to the registry before its own literal route
 * lands). This is deliberate, not dead code left behind by accident: the
 * catch-all exists for callers that want one parameterized endpoint rather
 * than hardcoding five URLs, and for forward-compatibility, without taking
 * over routing for the five providers that already have a dedicated, more
 * specifically-typed path.
 */
import type { DnsLookupFn, PinnedFetch, ProviderToolTurnPort, ProviderTurnEventRecord } from '@jini-ai/core/contracts/agents';
import { createApiError } from '@jini-ai/protocol';
import type { ProxyProviderRegistration } from '@jini-ai/core/contracts/agents/proxy-provider';
import { createSseStream, jsonResponse, readJsonBody, sameOriginRefusal, statusForError, type SseEvent } from '@jini-ai/core/contracts/server';
import type { DaemonRouteHost } from './route-host.js';
import { gated, type DaemonRoute } from './route-table.js';
import { SSE_CHARSET_HEADERS } from './sse-wire.js';
/** The union of every recognized provider's `run{Provider}ToolTurn` event type — what the `/api/proxy/:provider/stream` catch-all's registry (and, transitively, every fixed-path route) can emit — now typed at the injected port boundary (`ProviderTurnEventRecord`): the proxy only reads the discriminant; the vendor wire shape stays with the host-bound runner. */
type AnyProxyTurnEvent = ProviderTurnEventRecord;

/** Host-owned tool execution for one provider route: takes that provider's tool call, returns its tool result (vendor wire shapes stay with the host). */
export type ProxyToolExecutor = (call: unknown) => Promise<unknown>;

/** Diagnostic detail for an internal-error response this route deliberately does not disclose to the client (SEC-005, matching `runs.ts#RunInternalErrorContext`). Only reached if a turn-runner's promise itself rejects — every turn-runner already converts every provider/network failure into an `'error'`+`'end'` event pair internally, so this is a genuinely unexpected-exception path (e.g. a caller-supplied `executeTool` throwing). */
export interface ModelProxyInternalErrorContext {
  /** The registered provider id (the `:provider` path segment). */
  readonly provider: string;
  readonly correlationId: string;
  readonly error: unknown;
  /** The operation label the default line prints (`model-proxy/anthropic`). Additive. */
  readonly logSource?: string;
}

/** What the caller is told when a turn stops on an unexpected failure: what happened + what to do. */
const PROXY_STREAM_STOPPED_MESSAGE = 'The assistant response stopped. Review any completed actions before starting another turn. Copy the request ID and report this problem.';

export interface ModelProxyHttpDeps {
  /** Required: the providers this proxy serves, one registration per `/api/proxy/<id>/stream` route. The host imports the registration factories (e.g. `@jini-ai/provider-plugins/model-proxy-*`) and injects them; the daemon holds no provider list of its own. */
  readonly providers: readonly ProxyProviderRegistration[];
  /** Required: the provider tool-turn runners the host binds (the `run<Provider>ToolTurn` functions of the runtime package — see `ports/provider-http.ts`). */
  readonly toolTurns: ProviderToolTurnPort;
  /** Host-owned tool execution for the Anthropic proxy route. Omit to stream `tool_use` events without running a server-side tool loop (see module doc). */
  readonly anthropicExecuteTool?: ProxyToolExecutor;
  /** Host-owned tool execution for the OpenAI proxy route. Same default-unset behavior as `anthropicExecuteTool`. */
  readonly openaiExecuteTool?: ProxyToolExecutor;
  /** Host-owned tool execution for the Azure OpenAI proxy route. Same default-unset behavior as `anthropicExecuteTool`. */
  readonly azureExecuteTool?: ProxyToolExecutor;
  /** Host-owned tool execution for the Google (Gemini) proxy route. Same default-unset behavior as `anthropicExecuteTool`. */
  readonly googleExecuteTool?: ProxyToolExecutor;
  /** Host-owned tool execution for the Ollama proxy route. Same default-unset behavior as `anthropicExecuteTool`. */
  readonly ollamaExecuteTool?: ProxyToolExecutor;
  /** Host-owned sink for the real exception behind an internal-error SSE event (SEC-005). Without one, the default line carries the error class only (`reportRouteInternalError`). */
  readonly onInternalError?: (context: ModelProxyInternalErrorContext) => void;
  /**
   * Injectable HTTP transport, forwarded verbatim to every provider turn-runner as its own
   * `fetchImpl` option (`@jini-ai/agent-runtime`'s `AnthropicTurnOptions.fetchImpl`, etc.), which
   * itself defaults to that package's SSRF-guarded, DNS-pinned `pinnedFetch`. This is the
   * dependency-injection seam `__tests__/model-proxy.test.ts` uses to supply a fake transport
   * directly, instead of module-mocking `@jini-ai/agent-runtime`'s `connection-guard.ts` (or, worse,
   * its compiled `dist/` output, since this package only ever imports that package's single public
   * barrel). Defaults to unset, i.e. every route keeps using the real, guarded transport — **never
   * set this in production wiring**; doing so bypasses the SSRF guard entirely for whatever
   * transport is supplied.
   */
  readonly fetchImpl?: PinnedFetch;
  /**
   * Injectable DNS resolver, forwarded verbatim to every provider turn-runner as its own
   * `dnsLookup` option, which itself defaults to `@jini-ai/agent-runtime`'s `node:dns`-backed
   * `defaultDnsLookup`. Same test-only override rationale as `fetchImpl` — pairs with it so a test
   * never needs to mock `node:dns` either.
   */
  readonly dnsLookup?: DnsLookupFn;
}

interface ModelProxyStreamEvent extends SseEvent {
  readonly data: AnyProxyTurnEvent;
}

/** Wraps a raw turn-runner event for the SSE stream: `kind` drives both the wire `event:` field and the stream's `isEndEvent` auto-close, `data` preserves the exact event shape agent-runtime produced. */
function toStreamEvent(seq: number, event: AnyProxyTurnEvent): ModelProxyStreamEvent {
  return { opaqueCursor: String(seq), kind: event.type, data: event };
}

/** A JSON answer for a failure that happened before any stream existed. */
const failure = ({ status, error }: { readonly status: number; readonly error: unknown }): Response => jsonResponse({ status, body: { error } });

/** The redacted JSON 500 for a failure before the stream existed (nothing has been sent yet). */
const internalErrorResponse = ({ requestId }: { readonly requestId: string }): Response =>
  failure({ status: 500, error: createApiError({ code: 'INTERNAL_ERROR', message: PROXY_STREAM_STOPPED_MESSAGE }, { requestId }) });

type ProxyProvider = string;
type InternalErrorSink = (context: ModelProxyInternalErrorContext) => void;

/** One registered provider bound to this proxy's deps: the registration's parser plus a `run` that already carries the runners, transport seams and host tool executor. */
interface ProxyProviderRegistryEntry {
  readonly parse: ProxyProviderRegistration['parse'];
  readonly run: (parsed: unknown, onEvent: (event: { type: string }) => void) => Promise<unknown>;
}

/** Reports a failure and returns the request ID the client gets (the real error goes only to the host's sinks). */
function reportProxyError(
  { host, provider, error }: { readonly host: DaemonRouteHost; readonly provider: ProxyProvider; readonly error: unknown },
  { onInternalError }: { readonly onInternalError?: InternalErrorSink | undefined } = {},
): string {
  return String(host.reportInternalError({ report: { provider, error }, logSource: `model-proxy/${provider}`, message: PROXY_STREAM_STOPPED_MESSAGE }, { onInternalError }).requestId);
}

/**
 * What a client may be told about one turn event. A provider turn turns a failed upstream call into an
 * `error` event carrying that failure's own text, which can quote a credential, a URL or a host path:
 * the client gets fixed words and the request ID, and the full event goes to the host's error sink.
 * Every other event passes through unchanged.
 */
function clientSafeEvent(
  { event, host, provider }: { readonly event: AnyProxyTurnEvent; readonly host: DaemonRouteHost; readonly provider: ProxyProvider },
  { onInternalError }: { readonly onInternalError?: InternalErrorSink | undefined } = {},
): AnyProxyTurnEvent {
  if (event.type !== 'error') return event;
  const code = reportProxyError({ host, provider, error: event }, { onInternalError });
  return { type: 'error', message: PROXY_STREAM_STOPPED_MESSAGE, code } as AnyProxyTurnEvent;
}

/**
 * Opens the stream and starts the turn. The provider is not awaited before the response is returned: the
 * stream is the answer, and the turn's events (and its failure, if it rejects) arrive inside it. Every
 * reachable exit path inside every turn-runner emits exactly one `'end'`-kind event before its promise
 * resolves, and `isEndEvent` closes the stream the instant that event is sent. A turn that rejects outright
 * (e.g. a caller-supplied `executeTool` throwing) emitted no `'end'`, so two synthetic events close it. The
 * stream has no heartbeat: this route never sent one.
 */
function openProxyStream(
  { request, host, provider, onInternalError, entry, parsed }: { readonly request: Request; readonly host: DaemonRouteHost; readonly provider: ProxyProvider; readonly onInternalError?: InternalErrorSink | undefined; readonly entry: ProxyProviderRegistryEntry; readonly parsed: unknown },
): Response {
  let seq = 0;
  const nextSeq = () => { const current = seq; seq += 1; return current; };
  const stream = createSseStream<ModelProxyStreamEvent>({ scheduler: host.scheduler }, {
    signal: request.signal, keepAliveMs: false, headers: SSE_CHARSET_HEADERS,
    isEndEvent: ({ event }) => event.kind === 'end',
  });
  // An async closure so a runner that throws before returning a promise is reported like one that rejects.
  void (async () => entry.run(parsed, (event) => stream.send({ event: toStreamEvent(nextSeq(), clientSafeEvent({ event: event as AnyProxyTurnEvent, host, provider }, { onInternalError })) })))()
    .catch((error: unknown) => {
      const correlationId = reportProxyError({ host, provider, error }, { onInternalError });
      // `send` is a documented no-op once the stream is closed, so these two are safe to send unconditionally.
      stream.send({ event: toStreamEvent(nextSeq(), { type: 'error', message: PROXY_STREAM_STOPPED_MESSAGE, code: correlationId } as AnyProxyTurnEvent) });
      stream.send({ event: toStreamEvent(nextSeq(), { type: 'end', reason: 'error' } as AnyProxyTurnEvent) });
    });
  return stream.response;
}

interface ProxyAnswerInput {
  readonly request: Request;
  readonly host: DaemonRouteHost;
  readonly provider: ProxyProvider;
  readonly onInternalError?: InternalErrorSink | undefined;
  readonly entry: ProxyProviderRegistryEntry;
}

/**
 * The request handler body, shared by every fixed-path route and the `:provider` catch-all: same-origin
 * guard, body read, request parsing, then the stream. A throw before the stream exists (nothing has been
 * sent) answers the redacted JSON 500; provider-specific pieces (`provider`, `entry`) are injected.
 */
async function answerProxyStream({ request, host, provider, onInternalError, entry }: ProxyAnswerInput): Promise<Response> {
  try {
    const refused = sameOriginRefusal({ request, origin: host.context });
    if (refused) return refused;
    const body = await readJsonBody({ request }, { maxBytes: host.jsonBodyMaxBytes });
    if (!body.ok) return failure({ status: statusForError({ error: body.error }), error: body.error });
    const parsed = entry.parse(body.value);
    if (!parsed.ok) return failure({ status: 400, error: parsed.error });
    return openProxyStream({ request, host, provider, onInternalError, entry, parsed: parsed.value });
  } catch (error) {
    return internalErrorResponse({ requestId: reportProxyError({ host, provider, error }, { onInternalError }) });
  }
}

/**
 * Builds the `provider name -> {parse, run}` table that both the five fixed routes and the generic
 * catch-all dispatch through. Each entry's `run` closure captures `deps` for the optional
 * `executeTool` wiring and the transport test seams. `executeTool` is a fresh wrapper that calls
 * `deps.<provider>ExecuteTool` as a method at call time, so the host function sees exactly one
 * argument. (The "five" are now whichever registrations the host injects, not a fixed list.)
 *
 * Binds each injected registration to this proxy's deps, keyed by id. `executeTool` is a fresh wrapper over the host's `<id>ExecuteTool`
 * option, looked up at call time, so the host function sees exactly one argument. The lookup is by name
 * because those options are the advertised per-provider surface and the daemon cannot list providers.
 */
function buildProxyProviderRegistry(deps: ModelProxyHttpDeps): ReadonlyMap<string, ProxyProviderRegistryEntry> {
  const registry = new Map<string, ProxyProviderRegistryEntry>();
  for (const registration of deps.providers) {
    if (registry.has(registration.id)) throw new Error(`model proxy: duplicate provider registration "${registration.id}"`);
    const executeToolOption = `${registration.id}ExecuteTool`;
    const hostExecutors = deps as unknown as Readonly<Record<string, ProxyToolExecutor | undefined>>;
    registry.set(registration.id, {
      parse: (body) => registration.parse(body),
      run: (parsed, onEvent) => registration.run(parsed, {
        toolTurns: deps.toolTurns,
        onEvent,
        // The test-seam transport options every turn-runner accepts; each is forwarded only when the host supplied it (see `ModelProxyHttpDeps.fetchImpl`).
        shared: {
          ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
          ...(deps.dnsLookup ? { dnsLookup: deps.dnsLookup } : {}),
          ...(hostExecutors[executeToolOption] ? { executeTool: (call: unknown): Promise<unknown> => hostExecutors[executeToolOption]!(call) } : {}),
        },
      }),
    });
  }
  return registry;
}

/** The catch-all's registered path: the fixed label its generic incident carries. */
const CATCH_ALL_PATH = '/api/proxy/:provider/stream';

/** Reports a throw from the catch-all before {@link answerProxyStream} took over; returns the request ID. */
function reportCatchAllError(
  { host, providerParam, error, registry }: { readonly host: DaemonRouteHost; readonly providerParam: string; readonly error: unknown; readonly registry: ReadonlyMap<string, ProxyProviderRegistryEntry> },
  { onInternalError }: { readonly onInternalError?: InternalErrorSink | undefined } = {},
): string {
  if (registry.has(providerParam)) return reportProxyError({ host, provider: providerParam, error }, { onInternalError });
  // `onInternalError`'s contract only accepts the 5 recognized provider literals; a throw
  // this early (e.g. the same-origin check) may have happened before the provider name was even
  // validated, so an unrecognized/empty `providerParam` goes to the host's generic route sink
  // (method + registered path) instead of lying to that typed contract with a provider that was
  // never actually confirmed. The label is fixed words: the raw param is request input and can
  // carry anything, so it never reaches a log line.
  return String(host.reportInternalError({ report: { method: 'POST', path: CATCH_ALL_PATH, error }, logSource: 'model-proxy/unknown', message: PROXY_STREAM_STOPPED_MESSAGE }, { onInternalError: host.context.onInternalError }).requestId);
}

/**
 * `POST /api/proxy/:provider/stream` — see module doc's "the `:provider` catch-all's relationship to the
 * five fixed routes" section for why an unrecognized-but-registry-present provider name is the only branch
 * of this handler real HTTP traffic can reach for the five known provider ids.
 */
function genericProxyStreamRoute({ host, onInternalError, registry }: {
  readonly host: DaemonRouteHost;
  readonly onInternalError?: InternalErrorSink | undefined;
  readonly registry: ReadonlyMap<string, ProxyProviderRegistryEntry>;
}): DaemonRoute {
  return gated({
    route: {
      method: 'POST', path: CATCH_ALL_PATH,
      handler: async ({ request, params }) => {
        // Read ahead of the try: plain index access, never throws, and the catch needs it however far execution got.
        const providerParam = params.provider ?? '';
        try {
          const refused = sameOriginRefusal({ request, origin: host.context });
          if (refused) return refused;
          // `registry` is a Map, so an inherited object key such as `constructor` is not a provider.
          const entry = registry.get(providerParam);
          if (!entry) return failure({ status: 400, error: createApiError({ code: 'BAD_REQUEST', message: `unknown provider: ${providerParam}` }) });
          return await answerProxyStream({ request, host, provider: providerParam, onInternalError, entry });
        } catch (error) {
          // This catch covers failures before answerProxyStream takes over. No SSE response has been returned, so a JSON error can still be sent.
          return internalErrorResponse({ requestId: reportCatchAllError({ host, providerParam, error, registry }, { onInternalError }) });
        }
      },
    },
    gates: [{ name: 'same-origin' }],
  });
}

/** `POST /api/proxy/{anthropic,openai,azure,google,ollama}/stream` and the generic `POST /api/proxy/:provider/stream` catch-all, as data. */
export function modelProxyRoutes({ deps, host }: { readonly deps: ModelProxyHttpDeps; readonly host: DaemonRouteHost }, _optional: Record<string, never> = {}): DaemonRoute[] {
  const onInternalError = deps.onInternalError;
  const registry = buildProxyProviderRegistry(deps);
  // Each fixed route is a thin wrapper over `answerProxyStream` with `provider` fixed, not read from the path.
  // Fixed-route order is no longer load-bearing (a literal segment is matched before `:provider`), but the list stays the one source of the five names.
  // (Now the injected registrations' ids rather than a hard-coded five.)
  const fixed = [...registry.keys()].map((provider): DaemonRoute => gated({
    route: { method: 'POST', path: `/api/proxy/${provider}/stream`, handler: ({ request }) => answerProxyStream({ request, host, provider, onInternalError, entry: registry.get(provider)! }) },
    gates: [{ name: 'same-origin' }],
  }));
  return [...fixed, genericProxyStreamRoute({ host, onInternalError, registry })];
}
