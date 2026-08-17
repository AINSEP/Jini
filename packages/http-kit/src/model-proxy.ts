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
 * in `@jini-ai/http-kit` — this package has zero AI-provider knowledge anywhere
 * else in its surface, and that proposal recommended keeping it that way by
 * extending `@jini-ai/agent-runtime`'s existing `providers/` pattern instead.
 * This module is the `@jini-ai/http-kit` half of that split: request parsing,
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
 * per-vendor turn-runner (see that package's `source-map.md`'s own
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
 * `packages/deploy/source-map.md`'s precedent for "deferred real
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
} from '@jini-ai/agent-runtime';
import { createApiError } from '@jini-ai/protocol';
import type { AdapterContext } from './adapter.js';
import { validationError } from './request.js';
import { sendApiError } from './response.js';
import { guardSameOrigin } from './origin.js';
import { createSseChannel, type SseChannel, type SseEvent } from './sse.js';
import { err, ok, type Result } from './types.js';

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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

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

/**
 * Validates only the transport-level shape every proxied request shares
 * (non-empty `apiKey`/`model`, a `messages` array, and the optional numeric/
 * record fields' primitive types) — never the *contents* of `messages` or
 * `tools`, which is provider wire-protocol knowledge this package does not
 * have (see module doc). A malformed message/tool shape is instead rejected
 * by the real provider API and surfaces as a normal `'error'` SSE event,
 * exactly like any other upstream rejection.
 */
function parseCommon(body: unknown): Result<ParsedProxyCommon> {
  if (!isRecord(body)) return err(validationError('body must be a JSON object'));

  const apiKey = nonEmptyString(body.apiKey);
  if (!apiKey) {
    return err(validationError('apiKey must be a non-empty string', [{ path: 'apiKey', message: 'required non-empty string' }]));
  }
  const model = nonEmptyString(body.model);
  if (!model) {
    return err(validationError('model must be a non-empty string', [{ path: 'model', message: 'required non-empty string' }]));
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return err(validationError('messages must be a non-empty array', [{ path: 'messages', message: 'required non-empty array' }]));
  }
  if (body.baseUrl !== undefined && typeof body.baseUrl !== 'string') {
    return err(validationError('baseUrl must be a string when provided'));
  }
  if (body.temperature !== undefined && typeof body.temperature !== 'number') {
    return err(validationError('temperature must be a number when provided'));
  }
  if (body.maxTokens !== undefined && typeof body.maxTokens !== 'number') {
    return err(validationError('maxTokens must be a number when provided'));
  }
  if (body.maxToolTurns !== undefined && typeof body.maxToolTurns !== 'number') {
    return err(validationError('maxToolTurns must be a number when provided'));
  }
  if (body.extraHeaders !== undefined && !isRecord(body.extraHeaders)) {
    return err(validationError('extraHeaders must be an object when provided'));
  }

  return ok({
    apiKey,
    model,
    messages: body.messages,
    ...(body.baseUrl !== undefined ? { baseUrl: body.baseUrl as string } : {}),
    ...(body.temperature !== undefined ? { temperature: body.temperature as number } : {}),
    ...(body.maxTokens !== undefined ? { maxTokens: body.maxTokens as number } : {}),
    ...(body.maxToolTurns !== undefined ? { maxToolTurns: body.maxToolTurns as number } : {}),
    ...(body.extraHeaders !== undefined ? { extraHeaders: body.extraHeaders as Record<string, string> } : {}),
  });
}

interface ParsedAnthropicProxyRequest extends ParsedProxyCommon {
  readonly apiVersion?: string;
  readonly system?: string;
  readonly tools?: unknown[];
  readonly maxTokens: number;
}

function parseAnthropicProxyRequest(body: unknown): Result<ParsedAnthropicProxyRequest> {
  const common = parseCommon(body);
  if (!common.ok) return common;
  const record = body as Record<string, unknown>;

  if (typeof record.maxTokens !== 'number' || !Number.isFinite(record.maxTokens) || record.maxTokens <= 0) {
    return err(validationError('maxTokens must be a positive number', [{ path: 'maxTokens', message: 'required positive number' }]));
  }
  if (record.apiVersion !== undefined && typeof record.apiVersion !== 'string') {
    return err(validationError('apiVersion must be a string when provided'));
  }
  if (record.system !== undefined && typeof record.system !== 'string') {
    return err(validationError('system must be a string when provided'));
  }
  if (record.tools !== undefined && !Array.isArray(record.tools)) {
    return err(validationError('tools must be an array when provided'));
  }

  return ok({
    ...common.value,
    maxTokens: record.maxTokens,
    ...(record.apiVersion !== undefined ? { apiVersion: record.apiVersion as string } : {}),
    ...(record.system !== undefined ? { system: record.system as string } : {}),
    ...(record.tools !== undefined ? { tools: record.tools as unknown[] } : {}),
  });
}

interface ParsedOpenAiProxyRequest extends ParsedProxyCommon {
  readonly tools?: unknown[];
}

function parseOpenAiProxyRequest(body: unknown): Result<ParsedOpenAiProxyRequest> {
  const common = parseCommon(body);
  if (!common.ok) return common;
  const record = body as Record<string, unknown>;

  if (record.tools !== undefined && !Array.isArray(record.tools)) {
    return err(validationError('tools must be an array when provided'));
  }

  return ok({
    ...common.value,
    ...(record.tools !== undefined ? { tools: record.tools as unknown[] } : {}),
  });
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

  if (!common.value.baseUrl) {
    return err(validationError('baseUrl must be a non-empty string', [{ path: 'baseUrl', message: 'required non-empty string' }]));
  }
  if (typeof record.apiVersion !== 'string' || record.apiVersion.trim().length === 0) {
    return err(validationError('apiVersion must be a non-empty string', [{ path: 'apiVersion', message: 'required non-empty string' }]));
  }
  if (record.tools !== undefined && !Array.isArray(record.tools)) {
    return err(validationError('tools must be an array when provided'));
  }

  return ok({
    ...common.value,
    baseUrl: common.value.baseUrl,
    apiVersion: record.apiVersion,
    ...(record.tools !== undefined ? { tools: record.tools as unknown[] } : {}),
  });
}

interface ParsedGoogleProxyRequest extends ParsedProxyCommon {
  readonly system?: string;
  readonly tools?: unknown[];
  readonly maxOutputTokens?: number;
}

/** `parsed.messages` carries Gemini's own `contents: [{role, parts}]` shape at the call site below (cast, same convention as `parsed.messages as unknown as readonly AnthropicMessageParam[]`) — the HTTP JSON body schema stays uniform across all five providers; only each turn-runner's own field name differs. */
function parseGoogleProxyRequest(body: unknown): Result<ParsedGoogleProxyRequest> {
  const common = parseCommon(body);
  if (!common.ok) return common;
  const record = body as Record<string, unknown>;

  if (record.system !== undefined && typeof record.system !== 'string') {
    return err(validationError('system must be a string when provided'));
  }
  if (record.tools !== undefined && !Array.isArray(record.tools)) {
    return err(validationError('tools must be an array when provided'));
  }
  if (record.maxOutputTokens !== undefined && typeof record.maxOutputTokens !== 'number') {
    return err(validationError('maxOutputTokens must be a number when provided'));
  }

  return ok({
    ...common.value,
    ...(record.system !== undefined ? { system: record.system as string } : {}),
    ...(record.tools !== undefined ? { tools: record.tools as unknown[] } : {}),
    ...(record.maxOutputTokens !== undefined ? { maxOutputTokens: record.maxOutputTokens as number } : {}),
  });
}

/**
 * Now built on `parseCommon` like every other provider — `apiKey` is required, matching Open
 * Design's real `/api/proxy/ollama/stream` handler (`apps/daemon/src/routes/chat.ts:1298`'s
 * `if (!apiKey || !model)`), confirmed by a live side-by-side comparison against a running OD
 * daemon. An earlier version of this function made `apiKey` optional for a "local Ollama needs no
 * auth" rationale that turned out not to match OD's actual behavior — OD's default target is
 * Ollama Cloud (`https://ollama.com`), which does require a key; see `ollama-chat.ts`'s module doc
 * for the full corrected design.
 */
interface ParsedOllamaProxyRequest extends ParsedProxyCommon {
  readonly tools?: unknown[];
}

function parseOllamaProxyRequest(body: unknown): Result<ParsedOllamaProxyRequest> {
  const common = parseCommon(body);
  if (!common.ok) return common;
  const record = body as Record<string, unknown>;

  if (record.tools !== undefined && !Array.isArray(record.tools)) {
    return err(validationError('tools must be an array when provided'));
  }

  return ok({
    ...common.value,
    ...(record.tools !== undefined ? { tools: record.tools as unknown[] } : {}),
  });
}

interface ModelProxyStreamEvent extends SseEvent {
  readonly data: AnyProxyTurnEvent;
}

/** Wraps a raw turn-runner event for `sse.ts`'s generic channel: `kind` drives both the wire `event:` field and `createSseChannel`'s `isEndEvent` auto-close, `data` preserves the exact event shape agent-runtime produced. */
function toStreamEvent(seq: number, event: AnyProxyTurnEvent): ModelProxyStreamEvent {
  return { opaqueCursor: String(seq), kind: event.type, data: event };
}

/**
 * The actual request handler body, shared by every fixed-path route and the `:provider`
 * catch-all: same-origin guard, request parsing, SSE channel lifecycle, and the SEC-005 catch-all
 * for a turn-runner promise that rejects outright (see module doc). Provider-specific pieces
 * (`provider`, `parse`, `run`) are injected — extracted into its own function (rather than living
 * inline inside `registerProxyStreamRoute`'s `app.post` callback, as it did before this pass) so
 * the generic catch-all route below can invoke the identical logic with a `provider` value read
 * from `req.params` instead of a fixed string, without duplicating the SSE-wiring/error-handling
 * code a second time.
 */
async function runProxyStream<ParsedRequest, TurnEvent extends { type: string }>(
  req: Request,
  res: Response,
  adapter: AdapterContext,
  provider: ModelProxyInternalErrorContext['provider'],
  onInternalError: (context: ModelProxyInternalErrorContext) => void,
  parse: (body: unknown) => Result<ParsedRequest>,
  run: (parsed: ParsedRequest, onEvent: (event: TurnEvent) => void) => Promise<unknown>,
): Promise<void> {
  // Both `channel` and `seq` are declared ahead of the try so the catch block below can still
  // reach them however far execution got — including a throw from `guardSameOrigin`/`parse`,
  // before either exists yet.
  let seq = 0;
  let channel: SseChannel<ModelProxyStreamEvent> | undefined;
  try {
    const origin = guardSameOrigin(req, adapter);
    if (!origin.ok) {
      sendApiError(res, 403, origin.error);
      return;
    }
    const parsed = parse(req.body);
    if (!parsed.ok) {
      sendApiError(res, 400, parsed.error);
      return;
    }

    channel = createSseChannel<ModelProxyStreamEvent>(res, { isEndEvent: (event) => event.kind === 'end' });
    channel.open();

    await run(parsed.value, (event) => channel!.enqueue(toStreamEvent(seq++, event as unknown as AnyProxyTurnEvent)));
    // No `channel.end()` call here: every reachable exit path inside every turn-runner emits
    // exactly one `'end'`-kind event before its promise resolves (the duplicate-end-event fix —
    // see each provider module's own `turn-end-guard.ts` usage, and each function's own
    // `while (true)` loop, which cannot exit without first calling `emitEnd`), and `isEndEvent`
    // above already auto-closed the channel the instant that event was enqueued.
  } catch (error) {
    // This catch now covers the whole handler, not just `run(...)`: neither caller of this
    // function (`registerProxyStreamRoute`'s fixed routes, `registerGenericProxyStreamRoute`'s
    // catch-all) awaits or `.catch()`s the promise this function returns — exactly how Express
    // itself invokes every handler. `guardSameOrigin`/`parse` are Result-returning by contract and
    // don't throw today, but nothing enforces that; if either ever did, the throw used to become
    // an unhandled rejection with no process-level guard anywhere in this package's path, which is
    // Node's documented crash-the-process default. See the paired regression test in
    // `__tests__/model-proxy.test.ts`.
    const correlationId = randomUUID();
    onInternalError({ provider, correlationId, error });
    if (channel) {
      // `enqueue` is a documented no-op once the channel is already closed (`sse.ts`), so these
      // two synthetic events are safe to send unconditionally: normally the channel is still open
      // here (an exception escaping `run` — e.g. a caller-supplied `executeTool` throwing — means
      // no `'end'` event was ever emitted for this connection), and the synthetic `'end'`-kind
      // event's own `isEndEvent` match closes the channel via the same path as a real one.
      channel.enqueue(
        toStreamEvent(seq++, {
          type: 'error',
          message: 'an internal error occurred',
          code: correlationId,
        } as unknown as AnyProxyTurnEvent),
      );
      channel.enqueue(toStreamEvent(seq++, { type: 'end', reason: 'error' } as unknown as AnyProxyTurnEvent));
    } else if (!res.headersSent) {
      // The SSE channel was never opened (the throw happened before it), so no stream headers
      // were ever committed — a normal JSON error response is still possible here, matching how
      // `mountJsonRoute`'s own SEC-005 catch responds to a pre-response failure.
      sendApiError(res, 500, createApiError('INTERNAL_ERROR', 'an internal error occurred', { requestId: correlationId }));
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}

/** Registers one fixed-path provider route (`registerModelProxyRoutes`'s five calls below). Thin wrapper over {@link runProxyStream} — `provider` is a fixed string, not read from `req.params`. */
function registerProxyStreamRoute<ParsedRequest, TurnEvent extends { type: string }>(
  app: Express,
  path: string,
  adapter: AdapterContext,
  provider: ModelProxyInternalErrorContext['provider'],
  onInternalError: (context: ModelProxyInternalErrorContext) => void,
  parse: (body: unknown) => Result<ParsedRequest>,
  run: (parsed: ParsedRequest, onEvent: (event: TurnEvent) => void) => Promise<unknown>,
): void {
  app.post(path, (req: Request, res: Response) =>
    runProxyStream(req, res, adapter, provider, onInternalError, parse, run),
  );
}

/** Type-erased registry entry for the `:provider` catch-all — see {@link buildProxyProviderRegistry}. */
interface ProxyProviderRegistryEntry {
  readonly parse: (body: unknown) => Result<unknown>;
  readonly run: (parsed: unknown, onEvent: (event: { type: string }) => void) => Promise<unknown>;
}

/** Builds the `provider name -> {parse, run}` table the generic catch-all dispatches through. Each entry's `run` closure captures `deps` for the same optional `executeTool` wiring the five fixed routes use. */
function buildProxyProviderRegistry(deps: ModelProxyHttpDeps): Record<string, ProxyProviderRegistryEntry> {
  return {
    anthropic: {
      parse: parseAnthropicProxyRequest as (body: unknown) => Result<unknown>,
      run: ((parsed: ParsedAnthropicProxyRequest, onEvent: (event: AnthropicTurnEvent) => void) =>
        runAnthropicToolTurn({
          apiKey: parsed.apiKey,
          model: parsed.model,
          maxTokens: parsed.maxTokens,
          messages: parsed.messages as unknown as readonly AnthropicMessageParam[],
          onEvent,
          ...(parsed.baseUrl !== undefined ? { baseUrl: parsed.baseUrl } : {}),
          ...(parsed.apiVersion !== undefined ? { apiVersion: parsed.apiVersion } : {}),
          ...(parsed.system !== undefined ? { system: parsed.system } : {}),
          ...(parsed.tools !== undefined ? { tools: parsed.tools as unknown as readonly AnthropicToolDef[] } : {}),
          ...(parsed.temperature !== undefined ? { temperature: parsed.temperature } : {}),
          ...(parsed.maxToolTurns !== undefined ? { maxToolTurns: parsed.maxToolTurns } : {}),
          ...(parsed.extraHeaders !== undefined ? { extraHeaders: parsed.extraHeaders } : {}),
          ...(deps.anthropicExecuteTool
            ? { executeTool: (call: AnthropicToolCall): Promise<AnthropicToolResult> => deps.anthropicExecuteTool!(call) }
            : {}),
        })) as unknown as ProxyProviderRegistryEntry['run'],
    },
    openai: {
      parse: parseOpenAiProxyRequest as (body: unknown) => Result<unknown>,
      run: ((parsed: ParsedOpenAiProxyRequest, onEvent: (event: OpenAiTurnEvent) => void) =>
        runOpenAiToolTurn({
          apiKey: parsed.apiKey,
          model: parsed.model,
          messages: parsed.messages as unknown as readonly OpenAiMessageParam[],
          onEvent,
          ...(parsed.baseUrl !== undefined ? { baseUrl: parsed.baseUrl } : {}),
          ...(parsed.tools !== undefined ? { tools: parsed.tools as unknown as readonly OpenAiFunctionToolDef[] } : {}),
          ...(parsed.temperature !== undefined ? { temperature: parsed.temperature } : {}),
          ...(parsed.maxTokens !== undefined ? { maxTokens: parsed.maxTokens } : {}),
          ...(parsed.maxToolTurns !== undefined ? { maxToolTurns: parsed.maxToolTurns } : {}),
          ...(parsed.extraHeaders !== undefined ? { extraHeaders: parsed.extraHeaders } : {}),
          ...(deps.openaiExecuteTool
            ? { executeTool: (call: OpenAiToolCall): Promise<OpenAiToolResult> => deps.openaiExecuteTool!(call) }
            : {}),
        })) as unknown as ProxyProviderRegistryEntry['run'],
    },
    azure: {
      parse: parseAzureProxyRequest as (body: unknown) => Result<unknown>,
      run: ((parsed: ParsedAzureProxyRequest, onEvent: (event: AzureTurnEvent) => void) =>
        runAzureToolTurn({
          apiKey: parsed.apiKey,
          baseUrl: parsed.baseUrl,
          model: parsed.model,
          apiVersion: parsed.apiVersion,
          messages: parsed.messages as unknown as readonly AzureMessageParam[],
          onEvent,
          ...(parsed.tools !== undefined ? { tools: parsed.tools as unknown as readonly AzureFunctionToolDef[] } : {}),
          ...(parsed.temperature !== undefined ? { temperature: parsed.temperature } : {}),
          ...(parsed.maxTokens !== undefined ? { maxTokens: parsed.maxTokens } : {}),
          ...(parsed.maxToolTurns !== undefined ? { maxToolTurns: parsed.maxToolTurns } : {}),
          ...(parsed.extraHeaders !== undefined ? { extraHeaders: parsed.extraHeaders } : {}),
          ...(deps.azureExecuteTool
            ? { executeTool: (call: AzureToolCall): Promise<AzureToolResult> => deps.azureExecuteTool!(call) }
            : {}),
        })) as unknown as ProxyProviderRegistryEntry['run'],
    },
    google: {
      parse: parseGoogleProxyRequest as (body: unknown) => Result<unknown>,
      run: ((parsed: ParsedGoogleProxyRequest, onEvent: (event: GoogleTurnEvent) => void) =>
        runGoogleToolTurn({
          apiKey: parsed.apiKey,
          model: parsed.model,
          contents: parsed.messages as unknown as readonly GoogleContent[],
          onEvent,
          ...(parsed.baseUrl !== undefined ? { baseUrl: parsed.baseUrl } : {}),
          ...(parsed.system !== undefined ? { system: parsed.system } : {}),
          ...(parsed.tools !== undefined ? { tools: parsed.tools as unknown as readonly GoogleToolDef[] } : {}),
          ...(parsed.temperature !== undefined ? { temperature: parsed.temperature } : {}),
          ...(parsed.maxOutputTokens !== undefined ? { maxOutputTokens: parsed.maxOutputTokens } : {}),
          ...(parsed.maxToolTurns !== undefined ? { maxToolTurns: parsed.maxToolTurns } : {}),
          ...(parsed.extraHeaders !== undefined ? { extraHeaders: parsed.extraHeaders } : {}),
          ...(deps.googleExecuteTool
            ? { executeTool: (call: GoogleToolCall): Promise<GoogleToolResult> => deps.googleExecuteTool!(call) }
            : {}),
        })) as unknown as ProxyProviderRegistryEntry['run'],
    },
    ollama: {
      parse: parseOllamaProxyRequest as (body: unknown) => Result<unknown>,
      run: ((parsed: ParsedOllamaProxyRequest, onEvent: (event: OllamaTurnEvent) => void) =>
        runOllamaToolTurn({
          apiKey: parsed.apiKey,
          model: parsed.model,
          messages: parsed.messages as unknown as readonly OllamaMessageParam[],
          onEvent,
          ...(parsed.baseUrl !== undefined ? { baseUrl: parsed.baseUrl } : {}),
          ...(parsed.tools !== undefined ? { tools: parsed.tools as unknown as readonly OllamaFunctionToolDef[] } : {}),
          ...(parsed.temperature !== undefined ? { temperature: parsed.temperature } : {}),
          ...(parsed.maxTokens !== undefined ? { maxTokens: parsed.maxTokens } : {}),
          ...(parsed.maxToolTurns !== undefined ? { maxToolTurns: parsed.maxToolTurns } : {}),
          ...(parsed.extraHeaders !== undefined ? { extraHeaders: parsed.extraHeaders } : {}),
          ...(deps.ollamaExecuteTool
            ? { executeTool: (call: OllamaToolCall): Promise<OllamaToolResult> => deps.ollamaExecuteTool!(call) }
            : {}),
        })) as unknown as ProxyProviderRegistryEntry['run'],
    },
  };
}

const RECOGNIZED_PROVIDERS: ReadonlySet<ModelProxyInternalErrorContext['provider']> = new Set([
  'anthropic',
  'openai',
  'azure',
  'google',
  'ollama',
]);

function isRecognizedProvider(value: string): value is ModelProxyInternalErrorContext['provider'] {
  return RECOGNIZED_PROVIDERS.has(value as ModelProxyInternalErrorContext['provider']);
}

/**
 * Mounts `POST /api/proxy/:provider/stream` — see module doc's "the `:provider` catch-all's
 * relationship to the five fixed routes" section for why an unrecognized-but-registry-present
 * provider name is the only branch of this handler real HTTP traffic can reach for the five known
 * provider ids.
 */
function registerGenericProxyStreamRoute(
  app: Express,
  adapter: AdapterContext,
  onInternalError: (context: ModelProxyInternalErrorContext) => void,
  registry: Record<string, ProxyProviderRegistryEntry>,
): void {
  app.post('/api/proxy/:provider/stream', async (req: Request, res: Response) => {
    const origin = guardSameOrigin(req, adapter);
    if (!origin.ok) {
      sendApiError(res, 403, origin.error);
      return;
    }
    const providerParam = req.params.provider ?? '';
    const entry = registry[providerParam];
    if (!entry || !isRecognizedProvider(providerParam)) {
      sendApiError(res, 400, createApiError('BAD_REQUEST', `unknown provider: ${providerParam}`));
      return;
    }
    await runProxyStream(req, res, adapter, providerParam, onInternalError, entry.parse, entry.run);
  });
}

/** Mounts `POST /api/proxy/{anthropic,openai,azure,google,ollama}/stream` and the generic `POST /api/proxy/:provider/stream` catch-all. */
export function registerModelProxyRoutes(app: Express, deps: ModelProxyHttpDeps, adapter: AdapterContext): void {
  const onInternalError = deps.onInternalError ?? defaultInternalErrorSink;

  registerProxyStreamRoute<ParsedAnthropicProxyRequest, AnthropicTurnEvent>(
    app,
    '/api/proxy/anthropic/stream',
    adapter,
    'anthropic',
    onInternalError,
    parseAnthropicProxyRequest,
    (parsed, onEvent) =>
      runAnthropicToolTurn({
        apiKey: parsed.apiKey,
        model: parsed.model,
        maxTokens: parsed.maxTokens,
        messages: parsed.messages as unknown as readonly AnthropicMessageParam[],
        onEvent,
        ...(parsed.baseUrl !== undefined ? { baseUrl: parsed.baseUrl } : {}),
        ...(parsed.apiVersion !== undefined ? { apiVersion: parsed.apiVersion } : {}),
        ...(parsed.system !== undefined ? { system: parsed.system } : {}),
        ...(parsed.tools !== undefined ? { tools: parsed.tools as unknown as readonly AnthropicToolDef[] } : {}),
        ...(parsed.temperature !== undefined ? { temperature: parsed.temperature } : {}),
        ...(parsed.maxToolTurns !== undefined ? { maxToolTurns: parsed.maxToolTurns } : {}),
        ...(parsed.extraHeaders !== undefined ? { extraHeaders: parsed.extraHeaders } : {}),
        ...(deps.anthropicExecuteTool
          ? {
              executeTool: (call: AnthropicToolCall): Promise<AnthropicToolResult> => deps.anthropicExecuteTool!(call),
            }
          : {}),
      }),
  );

  registerProxyStreamRoute<ParsedOpenAiProxyRequest, OpenAiTurnEvent>(
    app,
    '/api/proxy/openai/stream',
    adapter,
    'openai',
    onInternalError,
    parseOpenAiProxyRequest,
    (parsed, onEvent) =>
      runOpenAiToolTurn({
        apiKey: parsed.apiKey,
        model: parsed.model,
        messages: parsed.messages as unknown as readonly OpenAiMessageParam[],
        onEvent,
        ...(parsed.baseUrl !== undefined ? { baseUrl: parsed.baseUrl } : {}),
        ...(parsed.tools !== undefined ? { tools: parsed.tools as unknown as readonly OpenAiFunctionToolDef[] } : {}),
        ...(parsed.temperature !== undefined ? { temperature: parsed.temperature } : {}),
        ...(parsed.maxTokens !== undefined ? { maxTokens: parsed.maxTokens } : {}),
        ...(parsed.maxToolTurns !== undefined ? { maxToolTurns: parsed.maxToolTurns } : {}),
        ...(parsed.extraHeaders !== undefined ? { extraHeaders: parsed.extraHeaders } : {}),
        ...(deps.openaiExecuteTool
          ? {
              executeTool: (call: OpenAiToolCall): Promise<OpenAiToolResult> => deps.openaiExecuteTool!(call),
            }
          : {}),
      }),
  );

  registerProxyStreamRoute<ParsedAzureProxyRequest, AzureTurnEvent>(
    app,
    '/api/proxy/azure/stream',
    adapter,
    'azure',
    onInternalError,
    parseAzureProxyRequest,
    (parsed, onEvent) =>
      runAzureToolTurn({
        apiKey: parsed.apiKey,
        baseUrl: parsed.baseUrl,
        model: parsed.model,
        apiVersion: parsed.apiVersion,
        messages: parsed.messages as unknown as readonly AzureMessageParam[],
        onEvent,
        ...(parsed.tools !== undefined ? { tools: parsed.tools as unknown as readonly AzureFunctionToolDef[] } : {}),
        ...(parsed.temperature !== undefined ? { temperature: parsed.temperature } : {}),
        ...(parsed.maxTokens !== undefined ? { maxTokens: parsed.maxTokens } : {}),
        ...(parsed.maxToolTurns !== undefined ? { maxToolTurns: parsed.maxToolTurns } : {}),
        ...(parsed.extraHeaders !== undefined ? { extraHeaders: parsed.extraHeaders } : {}),
        ...(deps.azureExecuteTool
          ? {
              executeTool: (call: AzureToolCall): Promise<AzureToolResult> => deps.azureExecuteTool!(call),
            }
          : {}),
      }),
  );

  registerProxyStreamRoute<ParsedGoogleProxyRequest, GoogleTurnEvent>(
    app,
    '/api/proxy/google/stream',
    adapter,
    'google',
    onInternalError,
    parseGoogleProxyRequest,
    (parsed, onEvent) =>
      runGoogleToolTurn({
        apiKey: parsed.apiKey,
        model: parsed.model,
        contents: parsed.messages as unknown as readonly GoogleContent[],
        onEvent,
        ...(parsed.baseUrl !== undefined ? { baseUrl: parsed.baseUrl } : {}),
        ...(parsed.system !== undefined ? { system: parsed.system } : {}),
        ...(parsed.tools !== undefined ? { tools: parsed.tools as unknown as readonly GoogleToolDef[] } : {}),
        ...(parsed.temperature !== undefined ? { temperature: parsed.temperature } : {}),
        ...(parsed.maxOutputTokens !== undefined ? { maxOutputTokens: parsed.maxOutputTokens } : {}),
        ...(parsed.maxToolTurns !== undefined ? { maxToolTurns: parsed.maxToolTurns } : {}),
        ...(parsed.extraHeaders !== undefined ? { extraHeaders: parsed.extraHeaders } : {}),
        ...(deps.googleExecuteTool
          ? {
              executeTool: (call: GoogleToolCall): Promise<GoogleToolResult> => deps.googleExecuteTool!(call),
            }
          : {}),
      }),
  );

  registerProxyStreamRoute<ParsedOllamaProxyRequest, OllamaTurnEvent>(
    app,
    '/api/proxy/ollama/stream',
    adapter,
    'ollama',
    onInternalError,
    parseOllamaProxyRequest,
    (parsed, onEvent) =>
      runOllamaToolTurn({
        apiKey: parsed.apiKey,
        model: parsed.model,
        messages: parsed.messages as unknown as readonly OllamaMessageParam[],
        onEvent,
        ...(parsed.baseUrl !== undefined ? { baseUrl: parsed.baseUrl } : {}),
        ...(parsed.tools !== undefined ? { tools: parsed.tools as unknown as readonly OllamaFunctionToolDef[] } : {}),
        ...(parsed.temperature !== undefined ? { temperature: parsed.temperature } : {}),
        ...(parsed.maxTokens !== undefined ? { maxTokens: parsed.maxTokens } : {}),
        ...(parsed.maxToolTurns !== undefined ? { maxToolTurns: parsed.maxToolTurns } : {}),
        ...(parsed.extraHeaders !== undefined ? { extraHeaders: parsed.extraHeaders } : {}),
        ...(deps.ollamaExecuteTool
          ? {
              executeTool: (call: OllamaToolCall): Promise<OllamaToolResult> => deps.ollamaExecuteTool!(call),
            }
          : {}),
      }),
  );

  registerGenericProxyStreamRoute(app, adapter, onInternalError, buildProxyProviderRegistry(deps));
}
