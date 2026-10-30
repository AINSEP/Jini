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
 * same-origin enforcement, and SSE transport (`sse.ts`, the same primitive
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
 * `packages/deploy/archived provenance ledger`'s precedent for "deferred real
 * `ToolExecutor` wiring." With no executor supplied, a turn still streams
 * back any `tool_use`/`tool_calls` the model requests (so a caller can act
 * on them itself and start a fresh request with the results appended to
 * `messages`) — the turn-runner just does not attempt the server-side
 * tool-execution loop. See `anthropic-messages.ts`/`openai-chat.ts`'s own
 * docs for that behavior.
 *
 * **The `:provider` catch-all's relationship to the five fixed routes.**
 * `registerModelProxyRoutes` registers the five literal-path routes first,
 * then the generic `/api/proxy/:provider/stream` catch-all last. Express
 * matches registered routes in registration order, so a request to
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
import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import {
  runAnthropicToolTurn,
  runAzureToolTurn,
  runGoogleToolTurn,
  runOllamaToolTurn,
  runOpenAiToolTurn,
  type AnthropicMessageParam,
  type AnthropicToolCall,
  type AnthropicToolDef,
  type AnthropicToolExecutor,
  type AnthropicToolResult,
  type AnthropicTurnEvent,
  type AzureFunctionToolDef,
  type AzureMessageParam,
  type AzureToolCall,
  type AzureToolExecutor,
  type AzureToolResult,
  type AzureTurnEvent,
  type GoogleContent,
  type GoogleToolCall,
  type GoogleToolDef,
  type GoogleToolExecutor,
  type GoogleToolResult,
  type GoogleTurnEvent,
  type OllamaFunctionToolDef,
  type OllamaMessageParam,
  type OllamaToolCall,
  type OllamaToolExecutor,
  type OllamaToolResult,
  type OllamaTurnEvent,
  type OpenAiFunctionToolDef,
  type OpenAiMessageParam,
  type OpenAiToolCall,
  type OpenAiToolExecutor,
  type OpenAiToolResult,
  type OpenAiTurnEvent,
  type DnsLookupFn,
  type PinnedFetch,
} from '@jini-ai/agent-runtime';
import { createApiError, type ApiError } from '@jini-ai/protocol';
import type { AdapterContext } from '@jini-ai/http-kit';
import { validationError } from '@jini-ai/http-kit';
import { sendApiError } from '@jini-ai/http-kit';
import { guardSameOrigin } from '@jini-ai/http-kit';
import { createSseChannel, type SseChannel, type SseEvent } from '@jini-ai/http-kit';
import { err, ok, type Result } from '@jini-ai/http-kit';
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

/** The union of every recognized provider's `run{Provider}ToolTurn` event type — what the `/api/proxy/:provider/stream` catch-all's registry (and, transitively, every fixed-path route) can emit. */
type AnyProxyTurnEvent = AnthropicTurnEvent | OpenAiTurnEvent | AzureTurnEvent | GoogleTurnEvent | OllamaTurnEvent;

/** Diagnostic detail for an internal-error response this route deliberately does not disclose to the client (SEC-005, matching `runs.ts#RunInternalErrorContext`). Only reached if a turn-runner's promise itself rejects — every turn-runner already converts every provider/network failure into an `'error'`+`'end'` event pair internally, so this is a genuinely unexpected-exception path (e.g. a caller-supplied `executeTool` throwing). */
export interface ModelProxyInternalErrorContext {
  readonly provider: 'anthropic' | 'openai' | 'azure' | 'google' | 'ollama';
  readonly correlationId: string;
  readonly error: unknown;
}

function defaultInternalErrorSink(context: ModelProxyInternalErrorContext): void {
  // eslint-disable-next-line no-console
  console.error(`[@jini-ai/http-kit] internal error (model-proxy/${context.provider}, correlationId=${context.correlationId})`, context.error);
}

export interface ModelProxyHttpDeps {
  /** Host-owned tool execution for the Anthropic proxy route. Omit to stream `tool_use` events without running a server-side tool loop (see module doc). */
  readonly anthropicExecuteTool?: AnthropicToolExecutor;
  /** Host-owned tool execution for the OpenAI proxy route. Same default-unset behavior as `anthropicExecuteTool`. */
  readonly openaiExecuteTool?: OpenAiToolExecutor;
  /** Host-owned tool execution for the Azure OpenAI proxy route. Same default-unset behavior as `anthropicExecuteTool`. */
  readonly azureExecuteTool?: AzureToolExecutor;
  /** Host-owned tool execution for the Google (Gemini) proxy route. Same default-unset behavior as `anthropicExecuteTool`. */
  readonly googleExecuteTool?: GoogleToolExecutor;
  /** Host-owned tool execution for the Ollama proxy route. Same default-unset behavior as `anthropicExecuteTool`. */
  readonly ollamaExecuteTool?: OllamaToolExecutor;
  /** Host-owned sink for the real exception behind a generic internal-error SSE event (SEC-005). Defaults to `console.error`. */
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
  if (!nonEmptyString(body.apiKey)) return requiredFieldError('apiKey', 'apiKey must be a non-empty string', 'required non-empty string');
  if (!nonEmptyString(body.model)) return requiredFieldError('model', 'model must be a non-empty string', 'required non-empty string');
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return requiredFieldError('messages', 'messages must be a non-empty array', 'required non-empty array');
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
  const error = firstRequiredFieldError(body) ?? firstOptionalFieldError(body, COMMON_OPTIONAL_CHECKS);
  if (error) return err({ error });
  return ok({
    value: {
      apiKey: body.apiKey as string,
      model: body.model as string,
      messages: body.messages as unknown[],
      ...(pickDefined(body, COMMON_OPTIONAL_CHECKS.map(([field]) => field)) as Partial<ParsedProxyCommon>),
    },
  });
}

/** Shared tail of every provider parser: rejects the first badly-typed provider-specific optional field, otherwise returns `base` plus `required` plus whichever of those optional fields are present. */
function extendParsed<Parsed extends ParsedProxyCommon>(
  { base, record, checks }: { readonly base: ParsedProxyCommon; readonly record: Record<string, unknown>; readonly checks: readonly OptionalFieldCheck[] },
  { required = {} }: { readonly required?: Partial<Parsed> } = {},
): Result<Parsed> {
  const error = firstOptionalFieldError(record, checks);
  if (error) return err({ error });
  const optional = pickDefined(record, checks.map(([field]) => field)) as Partial<Parsed>;
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
    return err({ error: requiredFieldError('maxTokens', 'maxTokens must be a positive number', 'required positive number') });
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
    return err({ error: requiredFieldError('baseUrl', 'baseUrl must be a non-empty string', 'required non-empty string') });
  }
  const apiVersion = nonEmptyString(record.apiVersion);
  if (!apiVersion) {
    return err({ error: requiredFieldError('apiVersion', 'apiVersion must be a non-empty string', 'required non-empty string') });
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

/** `parsed.messages` carries Gemini's own `contents: [{role, parts}]` shape at the call site below (cast, same convention as `parsed.messages as unknown as readonly AnthropicMessageParam[]`) — the HTTP JSON body schema stays uniform across all five providers; only each turn-runner's own field name differs. */
function parseGoogleProxyRequest(body: unknown): Result<ParsedGoogleProxyRequest> {
  const common = parseCommon(body);
  if (!common.ok) return common;
  return extendParsed<ParsedGoogleProxyRequest>({ base: common.value, record: body as Record<string, unknown>, checks: GOOGLE_OPTIONAL_CHECKS });
}

interface ModelProxyStreamEvent extends SseEvent {
  readonly data: AnyProxyTurnEvent;
}

/** Wraps a raw turn-runner event for `sse.ts`'s generic channel: `kind` drives both the wire `event:` field and `createSseChannel`'s `isEndEvent` auto-close, `data` preserves the exact event shape agent-runtime produced. */
function toStreamEvent(seq: number, event: AnyProxyTurnEvent): ModelProxyStreamEvent {
  return { opaqueCursor: String(seq), kind: event.type, data: event };
}

/** Answers a failure that happened before any SSE stream existed: a redacted JSON 500 if nothing was sent yet, otherwise just end the response (matching `mountJsonRoute`'s own SEC-005 catch). */
function respondInternalError(res: Response, correlationId: string): void {
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  sendApiError({ res, status: 500, error: createApiError({ code: 'INTERNAL_ERROR', message: 'an internal error occurred' }, { requestId: correlationId }) });
}

type ProxyProvider = ModelProxyInternalErrorContext['provider'];
type InternalErrorSink = (context: ModelProxyInternalErrorContext) => void;

/** Type-erased registry entry: one provider's request parser plus its turn-runner call. See {@link buildProxyProviderRegistry}. */
interface ProxyProviderRegistryEntry {
  readonly parse: (body: unknown) => Result<unknown>;
  readonly run: (parsed: unknown, onEvent: (event: { type: string }) => void) => Promise<unknown>;
}

/**
 * The actual request handler body, shared by every fixed-path route and the `:provider`
 * catch-all: same-origin guard, request parsing, SSE channel lifecycle, and the SEC-005 catch-all
 * for a turn-runner promise that rejects outright (see module doc). Provider-specific pieces
 * (`provider`, `entry.parse`, `entry.run`) are injected, so the generic catch-all route below can
 * invoke the identical logic with a `provider` value read from `req.params` instead of a fixed
 * string, without duplicating the SSE-wiring/error-handling code a second time.
 */
async function runProxyStream({ req, res, adapter, provider, onInternalError, entry }: {
  readonly req: Request;
  readonly res: Response;
  readonly adapter: AdapterContext;
  readonly provider: ProxyProvider;
  readonly onInternalError: InternalErrorSink;
  readonly entry: ProxyProviderRegistryEntry;
}): Promise<void> {
  // Both `channel` and `seq` are declared ahead of the try so the catch block below can still
  // reach them however far execution got — including a throw from `guardSameOrigin`/`parse`,
  // before either exists yet.
  let seq = 0;
  const nextSeq = () => {
    const current = seq;
    seq += 1;
    return current;
  };
  let channel: SseChannel<ModelProxyStreamEvent> | undefined;
  try {
    const origin = guardSameOrigin({ req, origin: adapter });
    if (!origin.ok) {
      sendApiError({ res, status: 403, error: origin.error });
      return;
    }
    const parsed = entry.parse(req.body);
    if (!parsed.ok) {
      sendApiError({ res, status: 400, error: parsed.error });
      return;
    }

    const openChannel = createSseChannel<ModelProxyStreamEvent>({ res }, { isEndEvent: ({ event }) => event.kind === 'end' });
    channel = openChannel;
    openChannel.open();

    await entry.run(parsed.value, (event) => openChannel.enqueue({ event: toStreamEvent(nextSeq(), event as AnyProxyTurnEvent) }));
    // No `channel.end()` call here: every reachable exit path inside every turn-runner emits
    // exactly one `'end'`-kind event before its promise resolves (the duplicate-end-event fix —
    // see each provider module's own `turn-end-guard.ts` usage, and each function's own
    // `while (true)` loop, which cannot exit without first calling `emitEnd`), and `isEndEvent`
    // above already auto-closed the channel the instant that event was enqueued.
  } catch (error) {
    // This catch now covers the whole handler, not just `run(...)`: neither caller of this
    // function (the fixed routes, `registerGenericProxyStreamRoute`'s catch-all) awaits or
    // `.catch()`s the promise this function returns — exactly how Express itself invokes every
    // handler. `guardSameOrigin`/`parse` are Result-returning by contract and don't throw today,
    // but nothing enforces that; if either ever did, the throw used to become an unhandled
    // rejection with no process-level guard anywhere in this package's path, which is Node's
    // documented crash-the-process default. See the paired regression test in
    // `__tests__/model-proxy.test.ts`.
    const correlationId = randomUUID();
    onInternalError({ provider, correlationId, error });
    if (!channel) {
      // The SSE channel was never opened (the throw happened before it), so no stream headers
      // were ever committed — a normal JSON error response is still possible here, matching how
      // `mountJsonRoute`'s own SEC-005 catch responds to a pre-response failure.
      respondInternalError(res, correlationId);
      return;
    }
    // `enqueue` is a documented no-op once the channel is already closed (`sse.ts`), so these
    // two synthetic events are safe to send unconditionally: normally the channel is still open
    // here (an exception escaping `run` — e.g. a caller-supplied `executeTool` throwing — means
    // no `'end'` event was ever emitted for this connection), and the synthetic `'end'`-kind
    // event's own `isEndEvent` match closes the channel via the same path as a real one.
    channel.enqueue({ event: toStreamEvent(nextSeq(), { type: 'error', message: 'an internal error occurred', code: correlationId } as AnyProxyTurnEvent) });
    channel.enqueue({ event: toStreamEvent(nextSeq(), { type: 'end', reason: 'error' } as AnyProxyTurnEvent) });
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

/** `tools` cast to the turn-runner's own tool-definition type, forwarded only when present (the parser never inspects tool contents — see `parseCommon`). */
function toolsOption<ToolDef>(tools: unknown[] | undefined): { tools?: readonly ToolDef[] } {
  return tools !== undefined ? { tools: tools as unknown as readonly ToolDef[] } : {};
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
      run: (parsed, onEvent: (event: AnthropicTurnEvent) => void) =>
        runAnthropicToolTurn(
          { apiKey: parsed.apiKey, model: parsed.model, maxTokens: parsed.maxTokens, messages: parsed.messages as unknown as readonly AnthropicMessageParam[], onEvent },
          {
            ...pickDefined(parsed, ['baseUrl', 'apiVersion', 'system', 'temperature', 'maxToolTurns', 'extraHeaders']),
            ...toolsOption<AnthropicToolDef>(parsed.tools),
            ...transportOptions(deps),
            ...(deps.anthropicExecuteTool ? { executeTool: (call: AnthropicToolCall): Promise<AnthropicToolResult> => deps.anthropicExecuteTool!(call) } : {}),
          },
        ),
    }),
    openai: defineProvider({
      parse: parseToolsProxyRequest,
      run: (parsed, onEvent: (event: OpenAiTurnEvent) => void) =>
        runOpenAiToolTurn(
          { apiKey: parsed.apiKey, model: parsed.model, messages: parsed.messages as unknown as readonly OpenAiMessageParam[], onEvent },
          {
            ...pickDefined(parsed, ['baseUrl', 'temperature', 'maxTokens', 'maxToolTurns', 'extraHeaders']),
            ...toolsOption<OpenAiFunctionToolDef>(parsed.tools),
            ...transportOptions(deps),
            ...(deps.openaiExecuteTool ? { executeTool: (call: OpenAiToolCall): Promise<OpenAiToolResult> => deps.openaiExecuteTool!(call) } : {}),
          },
        ),
    }),
    azure: defineProvider({
      parse: parseAzureProxyRequest,
      run: (parsed, onEvent: (event: AzureTurnEvent) => void) =>
        runAzureToolTurn(
          { apiKey: parsed.apiKey, baseUrl: parsed.baseUrl, model: parsed.model, messages: parsed.messages as unknown as readonly AzureMessageParam[], onEvent },
          {
            apiVersion: parsed.apiVersion,
            ...pickDefined(parsed, ['temperature', 'maxTokens', 'maxToolTurns', 'extraHeaders']),
            ...toolsOption<AzureFunctionToolDef>(parsed.tools),
            ...transportOptions(deps),
            ...(deps.azureExecuteTool ? { executeTool: (call: AzureToolCall): Promise<AzureToolResult> => deps.azureExecuteTool!(call) } : {}),
          },
        ),
    }),
    google: defineProvider({
      parse: parseGoogleProxyRequest,
      run: (parsed, onEvent: (event: GoogleTurnEvent) => void) =>
        runGoogleToolTurn(
          { apiKey: parsed.apiKey, model: parsed.model, contents: parsed.messages as unknown as readonly GoogleContent[], onEvent },
          {
            ...pickDefined(parsed, ['baseUrl', 'system', 'temperature', 'maxOutputTokens', 'maxToolTurns', 'extraHeaders']),
            ...toolsOption<GoogleToolDef>(parsed.tools),
            ...transportOptions(deps),
            ...(deps.googleExecuteTool ? { executeTool: (call: GoogleToolCall): Promise<GoogleToolResult> => deps.googleExecuteTool!(call) } : {}),
          },
        ),
    }),
    ollama: defineProvider({
      parse: parseToolsProxyRequest,
      run: (parsed, onEvent: (event: OllamaTurnEvent) => void) =>
        runOllamaToolTurn(
          { apiKey: parsed.apiKey, model: parsed.model, messages: parsed.messages as unknown as readonly OllamaMessageParam[], onEvent },
          {
            ...pickDefined(parsed, ['baseUrl', 'temperature', 'maxTokens', 'maxToolTurns', 'extraHeaders']),
            ...toolsOption<OllamaFunctionToolDef>(parsed.tools),
            ...transportOptions(deps),
            ...(deps.ollamaExecuteTool ? { executeTool: (call: OllamaToolCall): Promise<OllamaToolResult> => deps.ollamaExecuteTool!(call) } : {}),
          },
        ),
    }),
  };
}

/** Fixed-route registration order; load-bearing, since Express matches in registration order and the catch-all must come after all five. */
const PROXY_PROVIDERS: readonly ProxyProvider[] = ['anthropic', 'openai', 'azure', 'google', 'ollama'];

const RECOGNIZED_PROVIDERS: ReadonlySet<ProxyProvider> = new Set(PROXY_PROVIDERS);

function isRecognizedProvider(value: string): value is ProxyProvider {
  return RECOGNIZED_PROVIDERS.has(value as ProxyProvider);
}

/** Reports a throw from the catch-all before `runProxyStream` took over. */
function reportCatchAllError(providerParam: string, onInternalError: InternalErrorSink, error: unknown): string {
  const correlationId = randomUUID();
  // `onInternalError`'s contract only accepts the 5 recognized provider literals; a throw
  // this early (e.g. `guardSameOrigin`) may have happened before the provider name was even
  // validated, so an unrecognized/empty `providerParam` logs directly instead of lying to
  // that typed contract with a provider that was never actually confirmed.
  if (isRecognizedProvider(providerParam)) {
    onInternalError({ provider: providerParam, correlationId, error });
  } else {
    // eslint-disable-next-line no-console
    console.error(`[@jini-ai/http-kit] internal error (model-proxy/${providerParam || 'unknown'}, correlationId=${correlationId})`, error);
  }
  return correlationId;
}

/**
 * Mounts `POST /api/proxy/:provider/stream` — see module doc's "the `:provider` catch-all's
 * relationship to the five fixed routes" section for why an unrecognized-but-registry-present
 * provider name is the only branch of this handler real HTTP traffic can reach for the five known
 * provider ids.
 */
function registerGenericProxyStreamRoute({ app, adapter, onInternalError, registry }: {
  readonly app: Express;
  readonly adapter: AdapterContext;
  readonly onInternalError: InternalErrorSink;
  readonly registry: Record<string, ProxyProviderRegistryEntry>;
}): void {
  app.post('/api/proxy/:provider/stream', async (req: Request, res: Response) => {
    // Unlike the five fixed routes, this catch-all's own `guardSameOrigin` call sits ahead of
    // `runProxyStream` (the registry lookup below has to happen first, to even know which
    // `provider` string to hand `onInternalError`) — so it needs its own guard against the same
    // failure class `runProxyStream`'s catch already documents: `guardSameOrigin` is
    // Result-returning by contract but not guaranteed never to throw (`isLocalSameOrigin` really
    // does throw on a malformed `JINI_ALLOWED_ORIGINS` entry — see `origin-validation.ts`), and
    // this handler's returned promise is never awaited or `.catch()`-ed by Express, so an
    // uncaught throw here becomes an unhandled rejection with no process-level guard. See the
    // paired regression test in `__tests__/model-proxy.test.ts`.
    //
    // Read ahead of the try: plain property/index access on `req.params`/`registry`, never
    // throws, and the catch below needs it regardless of how far execution got.
    const providerParam = req.params.provider ?? '';
    try {
      const origin = guardSameOrigin({ req, origin: adapter });
      if (!origin.ok) {
        sendApiError({ res, status: 403, error: origin.error });
        return;
      }
      // Both checks are needed: `registry` is a plain object, so an inherited key such as
      // `constructor` yields a truthy `entry` that only the recognized-provider set rejects.
      const entry = registry[providerParam];
      if (!entry || !isRecognizedProvider(providerParam)) {
        sendApiError({ res, status: 400, error: createApiError({ code: 'BAD_REQUEST', message: `unknown provider: ${providerParam}` }) });
        return;
      }
      await runProxyStream({ req, res, adapter, provider: providerParam, onInternalError, entry });
    } catch (error) {
      // No SSE channel can exist yet at this point — `runProxyStream` owns opening one, and this
      // catch only reaches errors thrown before that call. A plain JSON error response is always
      // still possible, matching `runProxyStream`'s own "channel never opened" branch.
      respondInternalError(res, reportCatchAllError(providerParam, onInternalError, error));
    }
  });
}

/** Mounts `POST /api/proxy/{anthropic,openai,azure,google,ollama}/stream` and the generic `POST /api/proxy/:provider/stream` catch-all. */
export function registerModelProxyRoutes({ app, deps, adapter }: { readonly app: Express; readonly deps: ModelProxyHttpDeps; readonly adapter: AdapterContext }, _optional: Record<string, never> = {}): void {
  const onInternalError = deps.onInternalError ?? defaultInternalErrorSink;
  const registry = buildProxyProviderRegistry(deps);

  // Each fixed route is a thin wrapper over `runProxyStream` with `provider` fixed, not read from
  // `req.params`.
  for (const provider of PROXY_PROVIDERS) {
    const entry = registry[provider]!;
    app.post(`/api/proxy/${provider}/stream`, (req: Request, res: Response) =>
      runProxyStream({ req, res, adapter, provider, onInternalError, entry }),
    );
  }

  registerGenericProxyStreamRoute({ app, adapter, onInternalError, registry });
}
