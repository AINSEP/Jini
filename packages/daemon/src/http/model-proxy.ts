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
import type { PinnedFetch, ProviderToolTurnPort, ProviderTurnEventRecord } from '../ports/provider-http.js';
import { type DnsLookupFn } from '@jini-ai/core/contracts/agents';
import { createApiError, type ApiError } from '@jini-ai/protocol';
import {
  createSseStream,
  err,
  jsonResponse,
  ok,
  readJsonBody,
  sameOriginRefusal,
  statusForError,
  validationError,
  type Result,
  type SseEvent,
} from '@jini-ai/core/contracts/server';
import type { DaemonRouteHost } from './route-host.js';
import { gated, type DaemonRoute } from './route-table.js';
import { SSE_CHARSET_HEADERS } from './sse-wire.js';
import {
  firstOptionalFieldError,
  isArray,
  isNumber,
  isRecord,
  isString,
  nonEmptyString,
  pickDefined,
  requiredFieldError,
  type OptionalFieldCheck,
} from './model-proxy-fields.js';

/** The union of every recognized provider's `run{Provider}ToolTurn` event type — what the `/api/proxy/:provider/stream` catch-all's registry (and, transitively, every fixed-path route) can emit — now typed at the injected port boundary (`ProviderTurnEventRecord`): the proxy only reads the discriminant; the vendor wire shape stays with the host-bound runner. */
type AnyProxyTurnEvent = ProviderTurnEventRecord;

/** Host-owned tool execution for one provider route: takes that provider's tool call, returns its tool result (vendor wire shapes stay with the host). */
export type ProxyToolExecutor = (call: unknown) => Promise<unknown>;

/** Diagnostic detail for an internal-error response this route deliberately does not disclose to the client (SEC-005, matching `runs.ts#RunInternalErrorContext`). Only reached if a turn-runner's promise itself rejects — every turn-runner already converts every provider/network failure into an `'error'`+`'end'` event pair internally, so this is a genuinely unexpected-exception path (e.g. a caller-supplied `executeTool` throwing). */
export interface ModelProxyInternalErrorContext {
  readonly provider: 'anthropic' | 'openai' | 'azure' | 'google' | 'ollama';
  readonly correlationId: string;
  readonly error: unknown;
  /** The operation label the default line prints (`model-proxy/anthropic`). Additive. */
  readonly logSource?: string;
}

/** What the caller is told when a turn stops on an unexpected failure: what happened + what to do. */
const PROXY_STREAM_STOPPED_MESSAGE = 'The assistant response stopped. Review any completed actions before starting another turn. Copy the request ID and report this problem.';

export interface ModelProxyHttpDeps {
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

const TOOLS_CHECK: OptionalFieldCheck = ['tools', isArray, 'tools must be an array when provided'];
const SYSTEM_CHECK: OptionalFieldCheck = ['system', isString, 'system must be a string when provided'];

/** The shared optional fields, in the order `parseCommon` reports them. */
const COMMON_OPTIONAL_CHECKS: readonly OptionalFieldCheck[] = [
  ['baseUrl', isString, 'baseUrl must be a string when provided'],
  ['temperature', isNumber, 'temperature must be a number when provided'],
  ['maxTokens', isNumber, 'maxTokens must be a number when provided'],
  ['maxToolTurns', isNumber, 'maxToolTurns must be a number when provided'],
  ['extraHeaders', isRecord, 'extraHeaders must be an object when provided'],
];

interface ParsedProxyCommon {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model: string;
  readonly messages: unknown[];
  readonly temperature?: number;
  /** Optional here; individual providers narrow to required where their real API demands it (see `ParsedAnthropicProxyRequest`). OpenAI/Azure/Ollama all default to 8192 in their turn-runner when omitted — see each module's doc. */
  readonly maxTokens?: number;
  readonly maxToolTurns?: number;
  readonly extraHeaders?: Record<string, string>;
}

/** The required shared fields, in the order `parseCommon` reports them. */
function firstRequiredFieldError(body: Record<string, unknown>): ApiError | undefined {
  if (!nonEmptyString(body.apiKey)) return requiredFieldError({ path: 'apiKey', message: 'apiKey must be a non-empty string', issue: 'required non-empty string' });
  if (!nonEmptyString(body.model)) return requiredFieldError({ path: 'model', message: 'model must be a non-empty string', issue: 'required non-empty string' });
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return requiredFieldError({ path: 'messages', message: 'messages must be a non-empty array', issue: 'required non-empty array' });
  }
  return undefined;
}

/**
 * Validates only the transport-level shape every proxied request shares
 * (non-empty `apiKey`/`model`, a `messages` array, and the optional numeric/
 * record fields' primitive types) — never the *contents* of `messages` or
 * `tools`, which is provider wire-protocol knowledge this package does not
 * have (see module doc). A malformed message/tool shape is instead rejected
 * by the real provider API and surfaces as a normal `'error'` SSE event,
 * exactly like any other upstream rejection.
 *
 * SECURITY: `apiKey` travels in this JSON body, not an `Authorization` header
 * — a deliberate BYOK design choice (see module doc), not an oversight, but
 * one that only stays safe because every caller of this function is reached
 * through `runProxyStream`/`registerGenericProxyStreamRoute`, both of which
 * call `guardSameOrigin` before this parser ever runs (confirmed 2026-08-23;
 * see the "rejects a cross-origin request with 403 before touching fetch"
 * regression test per provider, plus the catch-all's own, in
 * `__tests__/model-proxy.test.ts` — each proves the credential is never
 * forwarded to `fetch` for a rejected cross-origin request). Do not loosen or
 * remove that same-origin enforcement without first moving `apiKey` to a
 * header — a body-carried credential is not safe to accept cross-origin.
 */
function parseCommon(body: unknown): Result<ParsedProxyCommon> {
  if (!isRecord(body)) return err({ error: validationError({ message: 'body must be a JSON object' }) });
  const error = firstRequiredFieldError(body) ?? firstOptionalFieldError({ record: body, checks: COMMON_OPTIONAL_CHECKS });
  if (error) return err({ error });
  return ok({
    value: {
      apiKey: body.apiKey as string,
      model: body.model as string,
      messages: body.messages as unknown[],
      ...(pickDefined({ source: body, keys: COMMON_OPTIONAL_CHECKS.map(([field]) => field) }) as Partial<ParsedProxyCommon>),
    },
  });
}

/** Shared tail of every provider parser: rejects the first badly-typed provider-specific optional field, otherwise returns `base` plus `required` plus whichever of those optional fields are present. */
function extendParsed<Parsed extends ParsedProxyCommon>(
  { base, record, checks }: { readonly base: ParsedProxyCommon; readonly record: Record<string, unknown>; readonly checks: readonly OptionalFieldCheck[] },
  { required = {} }: { readonly required?: Partial<Parsed> } = {},
): Result<Parsed> {
  const error = firstOptionalFieldError({ record, checks });
  if (error) return err({ error });
  const optional = pickDefined({ source: record, keys: checks.map(([field]) => field) }) as Partial<Parsed>;
  return ok({ value: { ...base, ...required, ...optional } as Parsed });
}

interface ParsedAnthropicProxyRequest extends ParsedProxyCommon {
  readonly apiVersion?: string;
  readonly system?: string;
  readonly tools?: unknown[];
  readonly maxTokens: number;
}

const ANTHROPIC_OPTIONAL_CHECKS: readonly OptionalFieldCheck[] = [
  ['apiVersion', isString, 'apiVersion must be a string when provided'],
  SYSTEM_CHECK,
  TOOLS_CHECK,
];

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function parseAnthropicProxyRequest(body: unknown): Result<ParsedAnthropicProxyRequest> {
  const common = parseCommon(body);
  if (!common.ok) return common;
  const record = body as Record<string, unknown>;
  if (!isPositiveFiniteNumber(record.maxTokens)) {
    return err({ error: requiredFieldError({ path: 'maxTokens', message: 'maxTokens must be a positive number', issue: 'required positive number' }) });
  }
  return extendParsed<ParsedAnthropicProxyRequest>({ base: common.value, record, checks: ANTHROPIC_OPTIONAL_CHECKS }, { required: { maxTokens: record.maxTokens } });
}

/**
 * OpenAI and Ollama accept the identical request shape: the shared fields plus optional `tools`.
 *
 * Ollama is built on `parseCommon` like every other provider — `apiKey` is required, matching Open
 * Design's real `/api/proxy/ollama/stream` handler (`apps/daemon/src/routes/chat.ts:1298`'s
 * `if (!apiKey || !model)`), confirmed by a live side-by-side comparison against a running OD
 * daemon. An earlier version of this function made `apiKey` optional for a "local Ollama needs no
 * auth" rationale that turned out not to match OD's actual behavior — OD's default target is
 * Ollama Cloud (`https://ollama.com`), which does require a key; see `ollama-chat.ts`'s module doc
 * for the full corrected design.
 */
interface ParsedToolsProxyRequest extends ParsedProxyCommon {
  readonly tools?: unknown[];
}

function parseToolsProxyRequest(body: unknown): Result<ParsedToolsProxyRequest> {
  const common = parseCommon(body);
  if (!common.ok) return common;
  return extendParsed<ParsedToolsProxyRequest>({ base: common.value, record: body as Record<string, unknown>, checks: [TOOLS_CHECK] });
}

interface ParsedAzureProxyRequest extends ParsedProxyCommon {
  /** Required for Azure, unlike the other four providers — every Azure OpenAI resource has its own endpoint (see `@jini-ai/agent-runtime`'s `azure-chat.ts`). */
  readonly baseUrl: string;
  /** Required for Azure — no sane global default exists at the HTTP-request-shape level either (the turn-runner itself does have a `'2024-10-21'` fallback, but this route requires the caller be explicit). */
  readonly apiVersion: string;
  readonly tools?: unknown[];
}

function parseAzureProxyRequest(body: unknown): Result<ParsedAzureProxyRequest> {
  const common = parseCommon(body);
  if (!common.ok) return common;
  const record = body as Record<string, unknown>;
  const { baseUrl } = common.value;
  // Truthiness only, unlike `apiVersion`'s trim check: a whitespace-only baseUrl passes here and
  // fails inside the turn-runner instead (pinned as "reported, not fixed").
  if (!baseUrl) {
    return err({ error: requiredFieldError({ path: 'baseUrl', message: 'baseUrl must be a non-empty string', issue: 'required non-empty string' }) });
  }
  const apiVersion = nonEmptyString(record.apiVersion);
  if (!apiVersion) {
    return err({ error: requiredFieldError({ path: 'apiVersion', message: 'apiVersion must be a non-empty string', issue: 'required non-empty string' }) });
  }
  return extendParsed<ParsedAzureProxyRequest>({ base: common.value, record, checks: [TOOLS_CHECK] }, { required: { baseUrl, apiVersion } });
}

interface ParsedGoogleProxyRequest extends ParsedProxyCommon {
  readonly system?: string;
  readonly tools?: unknown[];
  readonly maxOutputTokens?: number;
}

const GOOGLE_OPTIONAL_CHECKS: readonly OptionalFieldCheck[] = [
  SYSTEM_CHECK,
  TOOLS_CHECK,
  ['maxOutputTokens', isNumber, 'maxOutputTokens must be a number when provided'],
];

/** `parsed.messages` carries Gemini's own `contents: [{role, parts}]` shape at the call site below (cast, same convention as `parsed.messages`) — the HTTP JSON body schema stays uniform across all five providers; only each turn-runner's own field name differs. */
function parseGoogleProxyRequest(body: unknown): Result<ParsedGoogleProxyRequest> {
  const common = parseCommon(body);
  if (!common.ok) return common;
  return extendParsed<ParsedGoogleProxyRequest>({ base: common.value, record: body as Record<string, unknown>, checks: GOOGLE_OPTIONAL_CHECKS });
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

type ProxyProvider = ModelProxyInternalErrorContext['provider'];
type InternalErrorSink = (context: ModelProxyInternalErrorContext) => void;

/** Type-erased registry entry: one provider's request parser plus its turn-runner call. See {@link buildProxyProviderRegistry}. */
interface ProxyProviderRegistryEntry {
  readonly parse: (body: unknown) => Result<unknown>;
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

/** Erases one provider's concrete parse/run types into the registry's shared entry shape — the single cast every entry needs. */
function defineProvider<Parsed, TurnEvent extends { type: string }>(entry: {
  readonly parse: (body: unknown) => Result<Parsed>;
  readonly run: (parsed: Parsed, onEvent: (event: TurnEvent) => void) => Promise<unknown>;
}): ProxyProviderRegistryEntry {
  return entry as unknown as ProxyProviderRegistryEntry;
}

/** The test-seam transport options every turn-runner accepts; each is forwarded only when the host supplied it (see `ModelProxyHttpDeps.fetchImpl`). */
function transportOptions(deps: ModelProxyHttpDeps): { fetchImpl?: PinnedFetch; dnsLookup?: DnsLookupFn } {
  return {
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.dnsLookup ? { dnsLookup: deps.dnsLookup } : {}),
  };
}

/** `tools`, forwarded only when present; the cast to the turn-runner's own tool-definition type now happens at the host-bound port (the parser never inspects tool contents — see `parseCommon`). */
function toolsOption(tools: unknown[] | undefined): { tools?: readonly unknown[] } {
  return tools !== undefined ? { tools } : {};
}

/**
 * Builds the `provider name -> {parse, run}` table that both the five fixed routes and the generic
 * catch-all dispatch through. Each entry's `run` closure captures `deps` for the optional
 * `executeTool` wiring and the transport test seams. `executeTool` is a fresh wrapper that calls
 * `deps.<provider>ExecuteTool` as a method at call time, so the host function sees exactly one
 * argument.
 */
function buildProxyProviderRegistry(deps: ModelProxyHttpDeps): Record<string, ProxyProviderRegistryEntry> {
  return {
    anthropic: defineProvider({
      parse: parseAnthropicProxyRequest,
      run: (parsed, onEvent: (event: ProviderTurnEventRecord) => void) =>
        deps.toolTurns.anthropic(
          { apiKey: parsed.apiKey, model: parsed.model, maxTokens: parsed.maxTokens, messages: parsed.messages, onEvent },
          {
            ...pickDefined({ source: parsed, keys: ['baseUrl', 'apiVersion', 'system', 'temperature', 'maxToolTurns', 'extraHeaders'] }),
            ...toolsOption(parsed.tools),
            ...transportOptions(deps),
            ...(deps.anthropicExecuteTool ? { executeTool: (call: unknown): Promise<unknown> => deps.anthropicExecuteTool!(call) } : {}),
          },
        ),
    }),
    openai: defineProvider({
      parse: parseToolsProxyRequest,
      run: (parsed, onEvent: (event: ProviderTurnEventRecord) => void) =>
        deps.toolTurns.openai(
          { apiKey: parsed.apiKey, model: parsed.model, messages: parsed.messages, onEvent },
          {
            ...pickDefined({ source: parsed, keys: ['baseUrl', 'temperature', 'maxTokens', 'maxToolTurns', 'extraHeaders'] }),
            ...toolsOption(parsed.tools),
            ...transportOptions(deps),
            ...(deps.openaiExecuteTool ? { executeTool: (call: unknown): Promise<unknown> => deps.openaiExecuteTool!(call) } : {}),
          },
        ),
    }),
    azure: defineProvider({
      parse: parseAzureProxyRequest,
      run: (parsed, onEvent: (event: ProviderTurnEventRecord) => void) =>
        deps.toolTurns.azure(
          { apiKey: parsed.apiKey, baseUrl: parsed.baseUrl, model: parsed.model, messages: parsed.messages, onEvent },
          {
            apiVersion: parsed.apiVersion,
            ...pickDefined({ source: parsed, keys: ['temperature', 'maxTokens', 'maxToolTurns', 'extraHeaders'] }),
            ...toolsOption(parsed.tools),
            ...transportOptions(deps),
            ...(deps.azureExecuteTool ? { executeTool: (call: unknown): Promise<unknown> => deps.azureExecuteTool!(call) } : {}),
          },
        ),
    }),
    google: defineProvider({
      parse: parseGoogleProxyRequest,
      run: (parsed, onEvent: (event: ProviderTurnEventRecord) => void) =>
        deps.toolTurns.google(
          { apiKey: parsed.apiKey, model: parsed.model, contents: parsed.messages, onEvent },
          {
            ...pickDefined({ source: parsed, keys: ['baseUrl', 'system', 'temperature', 'maxOutputTokens', 'maxToolTurns', 'extraHeaders'] }),
            ...toolsOption(parsed.tools),
            ...transportOptions(deps),
            ...(deps.googleExecuteTool ? { executeTool: (call: unknown): Promise<unknown> => deps.googleExecuteTool!(call) } : {}),
          },
        ),
    }),
    ollama: defineProvider({
      parse: parseToolsProxyRequest,
      run: (parsed, onEvent: (event: ProviderTurnEventRecord) => void) =>
        deps.toolTurns.ollama(
          { apiKey: parsed.apiKey, model: parsed.model, messages: parsed.messages, onEvent },
          {
            ...pickDefined({ source: parsed, keys: ['baseUrl', 'temperature', 'maxTokens', 'maxToolTurns', 'extraHeaders'] }),
            ...toolsOption(parsed.tools),
            ...transportOptions(deps),
            ...(deps.ollamaExecuteTool ? { executeTool: (call: unknown): Promise<unknown> => deps.ollamaExecuteTool!(call) } : {}),
          },
        ),
    }),
  };
}

/** Fixed-route order is no longer load-bearing (a literal segment is matched before `:provider`), but the list stays the one source of the five names. */
const PROXY_PROVIDERS: readonly ProxyProvider[] = ['anthropic', 'openai', 'azure', 'google', 'ollama'];

const RECOGNIZED_PROVIDERS: ReadonlySet<ProxyProvider> = new Set(PROXY_PROVIDERS);

function isRecognizedProvider(value: string): value is ProxyProvider {
  return RECOGNIZED_PROVIDERS.has(value as ProxyProvider);
}

/** The catch-all's registered path: the fixed label its generic incident carries. */
const CATCH_ALL_PATH = '/api/proxy/:provider/stream';

/** Reports a throw from the catch-all before {@link answerProxyStream} took over; returns the request ID. */
function reportCatchAllError(
  { host, providerParam, error }: { readonly host: DaemonRouteHost; readonly providerParam: string; readonly error: unknown },
  { onInternalError }: { readonly onInternalError?: InternalErrorSink | undefined } = {},
): string {
  if (isRecognizedProvider(providerParam)) return reportProxyError({ host, provider: providerParam, error }, { onInternalError });
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
  readonly registry: Record<string, ProxyProviderRegistryEntry>;
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
          // Both checks are needed: `registry` is a plain object, so an inherited key such as
          // `constructor` yields a truthy `entry` that only the recognized-provider set rejects.
          const entry = registry[providerParam];
          if (!entry || !isRecognizedProvider(providerParam)) return failure({ status: 400, error: createApiError({ code: 'BAD_REQUEST', message: `unknown provider: ${providerParam}` }) });
          return await answerProxyStream({ request, host, provider: providerParam, onInternalError, entry });
        } catch (error) {
          // This catch covers failures before answerProxyStream takes over. No SSE response has been returned, so a JSON error can still be sent.
          return internalErrorResponse({ requestId: reportCatchAllError({ host, providerParam, error }, { onInternalError }) });
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
  const fixed = PROXY_PROVIDERS.map((provider): DaemonRoute => gated({
    route: { method: 'POST', path: `/api/proxy/${provider}/stream`, handler: ({ request }) => answerProxyStream({ request, host, provider, onInternalError, entry: registry[provider]! }) },
    gates: [{ name: 'same-origin' }],
  }));
  return [...fixed, genericProxyStreamRoute({ host, onInternalError, registry })];
}
