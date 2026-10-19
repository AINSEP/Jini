/**
 * @module providers/connection-test
 *
 * BYOK connection smoke test — sends a tiny "Reply with only: ok" completion
 * request to the configured provider endpoint and classifies the outcome, so
 * a settings UI can tell the operator "this endpoint works" without spending
 * a real chat turn to find out. Ported from OD's `apps/daemon/src/connectionTest.ts`
 * (`testProviderConnection` + `buildProviderCall` + `inspectProviderCompletion`),
 * narrowed to the four protocols `@jini-ai/ui`'s execution-tab canary exposes
 * (`anthropic` / `openai` / `azure` / `google`) — the origin also covers
 * `ollama` / `senseaudio` / `aihubmix` / `bedrock`, which stay out of scope
 * here the same way `model-catalog.ts` keeps Bedrock to a static seed and
 * Azure to an explicit "unsupported" response for model discovery.
 *
 * Shares this package's own vendored SSRF guard / secret redaction
 * (`connection-guard.ts`) and vendored connectivity types (`types.ts`) —
 * no OD workspace-package imports, matching every other file in this
 * directory.
 */

import type { DnsLookupFn } from './connection-guard.js';
import { defaultDnsLookup, validateBaseUrlResolved } from './connection-guard.js';
import { googleGenerateContentUrl } from './google.js';
import {
  appendVersionedApiPath,
  baseUrlRefusal,
  errorMessage,
  extractProviderErrorDetail,
  networkErrorToKind,
  parseJsonBody,
  redactApiKey,
  statusToKind,
  withRequestDeadline,
} from './provider-http.js';
import { buildOpenAIChatTokenParam, buildLegacyMaxTokensParam } from './token-params.js';
import type { ConnectionTestKind, ConnectionTestProtocol } from './types.js';

/** The four wire protocols this smoke test knows how to speak. A narrower
 *  type than {@link ConnectionTestProtocol} on purpose — see this module's
 *  header for what's out of scope and why. */
export type SupportedConnectionTestProtocol = 'anthropic' | 'openai' | 'azure' | 'google';

export interface ProviderConnectionTestRequest {
  protocol: ConnectionTestProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Azure only — the `api-version` query param. */
  apiVersion?: string;
}

export type ProviderConnectionTestInput = ProviderConnectionTestRequest & {
  signal?: AbortSignal;
  requestInit?: Pick<RequestInit, 'dispatcher'>;
  /** Injectable DNS resolver for the base-URL SSRF guard; defaults to `node:dns`. */
  dnsLookup?: DnsLookupFn;
};

export interface ConnectionTestResponse {
  ok: boolean;
  kind: ConnectionTestKind;
  latencyMs: number;
  model?: string;
  status?: number;
  detail?: string;
}

const SMOKE_PROMPT = 'Reply with only: ok';
/**
 * Headroom for a reasoning model's hidden thinking, plus the two-character answer.
 *
 * Was 64, chosen with the right instinct ("a reasoning model can spend the first few dozen tokens
 * on hidden reasoning") and the wrong number. On Gemini 2.5 models thinking tokens are billed
 * against `maxOutputTokens`, and their dynamic thinking budget routinely exceeds 64 on its own — so
 * the model spends the entire allowance thinking, stops at `finishReason: MAX_TOKENS`, and returns
 * a 2xx candidate with NO `content.parts` at all. The operator sees "Provider returned a 2xx
 * response without assistant text" against a key that provably works, which reads as a broken key.
 *
 * 512 rather than a thinking-disabling flag (`generationConfig.thinkingConfig.thinkingBudget: 0`)
 * because that field is Gemini-2.5-only and the Gemini API rejects unknown `generationConfig`
 * members outright — it would fix current models by breaking older ones. A larger ceiling is
 * provider-agnostic, and it is a ceiling, not a spend: a model that answers "ok" in two tokens
 * still costs two tokens.
 */
const CONNECTION_TEST_MAX_TOKENS = 512;
const CONNECTION_TEST_TIMEOUT_MS = 12_000;
const SAMPLE_MAX_CHARS = 120;

function truncateSample(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= SAMPLE_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, SAMPLE_MAX_CHARS - 1)}…`;
}

function isSmokeOkReply(text: string): boolean {
  return text.trim().toLowerCase() === 'ok';
}

/**
 * The provider's own reason for stopping, when a 2xx carried no usable text.
 *
 * Exists because "Provider returned a 2xx response without assistant text" is a true statement that
 * tells the operator nothing they can act on — it names the symptom and hides the cause. Every
 * supported protocol reports a stop reason under a different key, and the useful ones
 * (`MAX_TOKENS`, `content_filter`, `safety`) each imply a different fix.
 *
 * Read defensively: any of these may be absent, and a missing reason must degrade to the old
 * message rather than to `"undefined"`.
 */
function firstField(list: unknown, key: string): unknown {
  return (list as Array<Record<string, unknown> | undefined> | undefined)?.[0]?.[key];
}

function extractFinishReason(data: unknown): string {
  const root = data as { candidates?: unknown; choices?: unknown; stop_reason?: unknown };
  const raw = firstField(root.candidates, 'finishReason') ?? firstField(root.choices, 'finish_reason') ?? root.stop_reason;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : '';
}

interface ProviderCallShape {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  extractText: (data: unknown) => string;
}

function extractOpenAIMessageText(data: unknown): string {
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first = choices[0] as { message?: { content?: unknown }; text?: unknown } | undefined;
  if (typeof first?.message?.content === 'string') return first.message.content;
  if (typeof first?.text === 'string') return first.text;
  return '';
}

type SmokeCallInput = ProviderConnectionTestRequest;

function extractAnthropicText(data: unknown): string {
  const blocks = (data as { content?: unknown }).content;
  if (!Array.isArray(blocks)) return '';
  const textBlock = blocks.find(
    (block): block is { text: string } =>
      block &&
      typeof block === 'object' &&
      (block as { type?: string }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string',
  );
  return textBlock?.text ?? '';
}

function extractGoogleText(data: unknown): string {
  const candidates = (data as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return '';
  const parts = (candidates[0] as { content?: { parts?: unknown } }).content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    // Gemini 2.5 returns its hidden reasoning as ordinary parts flagged `thought: true`,
    // interleaved with the real answer. Joining them all turns a correct "ok" into
    // "<paragraph of reasoning>ok", which `isSmokeOkReply`'s exact match then rejects — a
    // model that answered correctly reported as a failed connection. Only the answer counts.
    .filter((p: { thought?: unknown }) => p?.thought !== true)
    .map((p: { text?: unknown }) => (typeof p?.text === 'string' ? p.text : ''))
    .join('');
}

function anthropicCall({ baseUrl, apiKey, model }: SmokeCallInput): ProviderCallShape {
  return {
    url: appendVersionedApiPath({ baseUrl, suffix: '/messages' }),
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: {
      model,
      max_tokens: CONNECTION_TEST_MAX_TOKENS,
      messages: [{ role: 'user', content: SMOKE_PROMPT }],
      stream: false,
    },
    extractText: extractAnthropicText,
  };
}

function openAICall({ baseUrl, apiKey, model }: SmokeCallInput): ProviderCallShape {
  return {
    url: appendVersionedApiPath({ baseUrl, suffix: '/chat/completions' }),
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: {
      model,
      ...buildOpenAIChatTokenParam({ model: model, maxTokens: CONNECTION_TEST_MAX_TOKENS }),
      messages: [{ role: 'user', content: SMOKE_PROMPT }],
      stream: false,
    },
    extractText: extractOpenAIMessageText,
  };
}

// `buildLegacyMaxTokensParam`/`buildMaxCompletionTokensParam` cover the Azure
// legacy-vs-`max_completion_tokens` split the same way OD's daemon retries a
// rejected `max_tokens` param; this smoke test keeps the simpler single-shot
// legacy param (a connection test failing on a param-name mismatch on a
// reasoning-tier Azure deployment is a known, narrow gap — see this
// package's `archived provenance ledger`) rather than porting OD's full retry-on-400 loop.
function azureCall({ baseUrl, apiKey, model, apiVersion: requestedApiVersion }: SmokeCallInput): ProviderCallShape {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, '');
  const usesVersionedOpenAIPath = /\/openai\/v\d+(?:$|\/)/.test(basePath);
  const apiVersion = requestedApiVersion?.trim() || (usesVersionedOpenAIPath ? '' : '2024-10-21');
  url.pathname = usesVersionedOpenAIPath
    ? `${basePath}/chat/completions`
    : `${basePath}/openai/deployments/${encodeURIComponent(model)}/chat/completions`;
  if (apiVersion) url.searchParams.set('api-version', apiVersion);
  return {
    url: url.toString(),
    headers: { 'content-type': 'application/json', 'api-key': apiKey },
    body: {
      ...(usesVersionedOpenAIPath ? { model } : {}),
      ...buildLegacyMaxTokensParam({ maxTokens: CONNECTION_TEST_MAX_TOKENS }),
      messages: [{ role: 'user', content: SMOKE_PROMPT }],
      stream: false,
    },
    extractText: extractOpenAIMessageText,
  };
}

// No blank-`baseUrl` fallback: the SSRF guard has already refused any base URL
// that does not parse, so a blank one never reaches a request builder.
function googleCall({ baseUrl, apiKey, model }: SmokeCallInput): ProviderCallShape {
  return {
    url: googleGenerateContentUrl({ baseUrl, model }),
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: {
      contents: [{ role: 'user', parts: [{ text: SMOKE_PROMPT }] }],
      generationConfig: { maxOutputTokens: CONNECTION_TEST_MAX_TOKENS },
    },
    extractText: extractGoogleText,
  };
}

/** One request builder per protocol this smoke test speaks; its keys ARE the supported set. */
const PROVIDER_CALL_BUILDERS: Record<SupportedConnectionTestProtocol, (input: SmokeCallInput) => ProviderCallShape> = {
  anthropic: anthropicCall,
  openai: openAICall,
  azure: azureCall,
  google: googleCall,
};

function isSupportedProtocol(protocol: ConnectionTestProtocol): protocol is SupportedConnectionTestProtocol {
  return Object.hasOwn(PROVIDER_CALL_BUILDERS, protocol);
}

/** Every refusal `testProviderConnection` can give before any network request, or `undefined` to proceed. */
async function connectionPreflight(input: ProviderConnectionTestInput): Promise<{ kind: ConnectionTestKind; detail: string } | undefined> {
  if (!isSupportedProtocol(input.protocol)) {
    return { kind: 'unknown', detail: `Connection test is not supported for protocol "${input.protocol}".` };
  }
  // Every supported protocol here (anthropic/openai/azure/google) puts the
  // key straight into the outbound request (`PROVIDER_CALL_BUILDERS` above), so
  // an empty key is never a legitimate probe — the provider would reject it
  // with a generic "no credential" error indistinguishable from a broken
  // integration. Same fail-fast rationale as `listProviderModels`'s
  // `PROTOCOLS_REQUIRING_API_KEY` guard, checked first so a missing key
  // short-circuits before any DNS/network access.
  if (!input.apiKey.trim()) {
    return { kind: 'auth_failed', detail: 'No API key saved. Save one to test the connection.' };
  }
  return baseUrlRefusal(await validateBaseUrlResolved({ baseUrl: input.baseUrl, lookup: input.dnsLookup ?? defaultDnsLookup }));
}

type ProbeContext = { apiKey: string; model: string; latencyMs: number; status: number };

function httpFailure({ data, rawText }: { data: unknown; rawText: string }, ctx: ProbeContext): ConnectionTestResponse {
  const redactedDetail = redactApiKey({ text: extractProviderErrorDetail({ data, rawText }).slice(0, 240), apiKey: ctx.apiKey });
  return {
    ok: false,
    kind: statusToKind({ status: ctx.status }, { detailText: redactedDetail }),
    latencyMs: ctx.latencyMs,
    model: ctx.model,
    status: ctx.status,
    detail: redactedDetail || (ctx.status === 404 ? 'HTTP 404 from provider; check the Base URL path.' : ''),
  };
}

function smokeReplyResult({ data, text }: { data: unknown; text: string }, ctx: ProbeContext): ConnectionTestResponse {
  const { latencyMs, model, status } = ctx;
  if (isSmokeOkReply(text)) {
    return { ok: true, kind: 'success', latencyMs, model, status, detail: 'valid completion' };
  }
  // Redacted for exactly the reason the `!response.ok` branch (`httpFailure`)
  // redacts. The transport succeeded here (HTTP 2xx) but the smoke reply
  // did not match, so this is still a failure path echoing arbitrary
  // provider text straight back into the admin UI — and a misbehaving or
  // hostile endpoint that reflects the request's own `Authorization`
  // header puts the operator's key in `detail` verbatim. Two independent
  // audits reproduced that, each from a different call boundary; the
  // redaction was simply missing on this one branch.
  const sample = truncateSample(redactApiKey({ text, apiKey: ctx.apiKey }));
  if (sample) return { ok: false, kind: 'unknown', latencyMs, model, status, detail: `Expected smoke test reply "ok"; got "${sample}"` };
  // Naming the stop reason turns an unactionable "it returned nothing" into a diagnosis:
  // `MAX_TOKENS` means the smoke budget was too small (usually a thinking model), a safety or
  // content-filter reason means the probe was blocked, not that the endpoint is broken.
  const finishReason = extractFinishReason(data);
  const detail = finishReason
    ? `Provider returned a 2xx response without assistant text (finish reason: ${finishReason})`
    : 'Provider returned a 2xx response without assistant text';
  return { ok: false, kind: 'unknown', latencyMs, model, status, detail };
}

async function probe(
  { input, call, model, start, signal }: { input: ProviderConnectionTestInput; call: ProviderCallShape; model: string; start: number; signal: AbortSignal },
): Promise<ConnectionTestResponse> {
  const response = await fetch(call.url, {
    ...input.requestInit,
    method: 'POST',
    headers: call.headers,
    body: JSON.stringify(call.body),
    signal,
  });
  const ctx: ProbeContext = { apiKey: input.apiKey, model, latencyMs: Date.now() - start, status: response.status };
  const rawText = await response.text().catch(() => '');
  // A non-JSON body leaves `data` as `{}` — both paths below treat that as
  // "no usable text" (the error path falls back to the raw body).
  const { data } = parseJsonBody(rawText);
  if (!response.ok) return httpFailure({ data, rawText }, ctx);
  return smokeReplyResult({ data, text: call.extractText(data) }, ctx);
}

/**
 * Probes a BYOK provider endpoint with the supplied credentials by sending a
 * tiny smoke-test completion request, and classifies the result. Validates
 * the base URL (sync + DNS-resolved SSRF guard) before issuing any request,
 * exactly like {@link import('./model-catalog.js').listProviderModels}.
 *
 * Never throws for provider-side or network failures — every failure path
 * resolves to `{ ok: false, kind, detail }`. Only truly unsupported
 * protocols short-circuit before any network access.
 *
 * @complexity O(1) — one bounded-size HTTP request with a hard timeout.
 * @overallScore 100
 */
export async function testProviderConnection(requiredArgs: Pick<ProviderConnectionTestInput, "protocol" | "baseUrl" | "apiKey" | "model">, optionalArgs: Omit<ProviderConnectionTestInput, "protocol" | "baseUrl" | "apiKey" | "model"> = {}): Promise<ConnectionTestResponse> {
  const input: ProviderConnectionTestInput = { ...optionalArgs, ...requiredArgs };
  const start = Date.now();
  const model = input.model.trim();
  const failure = (kind: ConnectionTestKind, detail: string): ConnectionTestResponse =>
    ({ ok: false, kind, latencyMs: Date.now() - start, model, detail });

  const refusal = await connectionPreflight(input);
  if (refusal) return failure(refusal.kind, refusal.detail);

  let call: ProviderCallShape;
  try {
    // Safe: `connectionPreflight` refused every protocol outside PROVIDER_CALL_BUILDERS.
    call = PROVIDER_CALL_BUILDERS[input.protocol as SupportedConnectionTestProtocol]({ ...input, model });
  } catch (err) {
    return failure('unknown', redactApiKey({ text: errorMessage(err), apiKey: input.apiKey }));
  }

  try {
    return await withRequestDeadline(
      { timeoutMs: CONNECTION_TEST_TIMEOUT_MS, run: (signal) => probe({ input, call, model, start, signal }) },
      { signal: input.signal },
    );
  } catch (err) {
    return failure(networkErrorToKind(err), redactApiKey({ text: errorMessage(err), apiKey: input.apiKey }));
  }
}
