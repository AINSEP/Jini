# Runtime API

Every public callable accepts at most two objects: required arguments, then
optional arguments. Zero-input operations remain callable without arguments.
Custom dependencies are ports in those objects; native Node/web callbacks keep
their upstream contracts. The package version stays unchanged. The classifier/redactor exports now belong to
platform/core, as described below. Positional compatibility wrappers are not provided.

Omit optional properties when using their defaults; explicitly assigning
`undefined` is excluded by the package's exact optional-property contracts.
Both `parsePiModels({ stdout })` and `parsePiRpcModels({ stdout })` follow the
required-argument object convention.

## CLI definitions and streams

```ts
import { getAgentDef, createJsonLineStream, createRoleMarkerGuard } from '@jini-ai/agent-runtime';

const def = getAgentDef({ id: 'claude' });
const argv = def?.buildArgs({ prompt: 'Hello', imagePaths: [] }, {
  options: { model: 'sonnet', permissionMode: 'restricted' },
});
const stream = createJsonLineStream({
  onMessage: ({ message, rawLine }) => console.log(message, rawLine),
});
stream.feed({ chunk: '{"id":1}\n' });
stream.flush();
const guard = createRoleMarkerGuard({ messageId: 'request-1' });
const visible = guard.feedText({ text: 'Hello' });
```

`RuntimeAgentDef.fetchModels({ resolvedBin, env })`, `listModels.parse({ stdout })`
and `stdoutPolicy.sanitize({ fullText })` follow the same convention. Session
factories take `{ child, prompt, send }` first, with cwd/model/images/permission
and timing controls in the optional object. Session `send` receives
`{ event, payload }`; `AccountFailureClassifier.classify` receives `{ text }`.

`AcpModelProbe.detectModels({ bin, args }, { cwd, env, timeoutMs, clientName,
clientVersion, defaultModelOption })` uses the same split as `detectAcpModels`.
The root `probeAcpModels` name refers to the injectable probe; `detectAcpModels`
remains the real subprocess transport. Hosts can bind that transport through
`setAcpModelProbe({ probe: { detectModels: detectAcpModels } })`, or supply a custom
probe. Pass `{ probe: null }` to restore the no-op probe.

## Provider-neutral turns

```ts
import { runProviderToolTurn, providerTurnAdapters } from '@jini-ai/agent-runtime/providers/tool-turn';

await runProviderToolTurn({
  protocol, adapters: providerTurnAdapters, apiKey, model, system, messages,
  tools, executeTool, onEvent,
}, { baseUrl, maxTokens, maxToolTurns, signal });
```

The first object requires the protocol, all four adapter ports (`anthropic`,
`openai`, `azure`, `google`), credentials, model, system prompt, conversation,
tool descriptors, executor and event sink. Hosts may replace any adapter.
Tool descriptors contain `{ id, description?, inputSchema? }`; the executor
receives `{ id, name, input }` and returns `{ content, isError? }`. Content is
text or an array of text/image blocks. The event sink receives a discriminated
event object. The final adapter end event takes precedence over raw provider
stop/finish codes in the returned `{ stopReason, toolTurns }`.

Azure requires `baseUrl` and reports an error/end event when it is absent.
Low-level provider adapters retain their individual required inputs and optional
HTTP/DNS ports; they are not replaced by a second implementation of tool loops.

The same subpath exports `googleParametersOf({ descriptor }, { maxRefDepth })`,
`sanitizeGoogleSchema({ schema }, { defs, maxRefDepth })`,
`findNumericEnumPaths({ schema }, { prefix })`, and
`coerceNumericEnumStringsToNumbers({ input, paths })`.
Schema conversion approximates Gemini's accepted guidance; hosts validate the
actual tool input. Reference expansion defaults to four hops. Numeric-enum
reversal covers dot-separated object-property paths; arrays, references, unions
and property names containing literal dots retain the inherited limitations.

## Live model catalog cache

```ts
import { ModelCatalogCache, unionModels } from '@jini-ai/agent-runtime/model-catalog/cache';

const cache = new ModelCatalogCache({ discover, clock, merge: unionModels }, {
  ttlMs: 300_000, onDiscoveryError,
});
const models = await cache.get({ cacheKey: [tenant, principal, provider, credentialScope], fallback }, {
  discover: credentialScopedDiscovery,
});
```

`discover({ cacheKey })` returns models or null; `clock.nowMs()` supplies time;
`merge({ fallback, live })` supplies the host's merge policy. The optional
per-read discovery port can close over an already-resolved credential. Every
scope that affects discovery belongs in the host-provided key tuple. Instances
own their state; tuple encoding prevents delimiter collisions.

Concurrent reads for a key share one discovery. Successes and failures expire
after the configured TTL, measured from the start of discovery. Every read
merges its current fallback. `unionModels({ fallback, live })` keeps fallback
entries and labels in order, then appends unseen live IDs. Entries persist until
the instance is discarded; hosts choose that lifetime. Discovery-error callbacks
should not throw. The legacy AMR cache continues returning stale remote models
while refreshing, or a preset on cold start; it shares the single-flight loader
without adopting the blocking discovery cache policy.

## Universal SSE decoder

```ts
import { decodeSseStream } from '@jini-ai/agent-runtime/providers/sse-decode';

for await (const frame of decodeSseStream({ source: responseChunks })) {
  // frame: { event: string | null, data: string }
}
```

The source is an async iterable of strings or Uint8Array chunks. The decoder
preserves streaming UTF-8, joins multiple data lines, ignores comments and
unknown fields, accepts LF/CRLF, and flushes a trailing record when the stream
ends. It owns framing only; reconnect, event interpretation, fetch and endpoint
policy belong to the host. This subpath and the cache avoid Node imports.

Provider network predicates now live in `@jini-ai/platform/net`; secret redaction lives in `@jini-ai/core` and takes `{ input }` with `{ exactSecrets }`. Runtime no longer re-exports those utilities. Core's conservative policy retains model/request identifiers and returns categorized redaction markers. Model catalog hosts pass core `Clock` (`nowMs()`); ACP transport values use `UnknownRecord` to avoid claiming validated JSON.

PKCE providers pass `{ verifierBytes: 64 }` to the main OAuth API. Fixed-issuer token operations use its URL guard, bounded parser, timeout, redirect refusal and typed errors; the runtime maps normalized tokens into its existing persisted provider DTO. Pending callbacks use the main storage factory with an explicit exclusive expiry option and an unref scheduler. The cache is bounded to the main 256-entry default. The conversion report remains in the repository for relocation and is excluded from package files.
