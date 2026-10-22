Spec ID: SPEC-JINI-AGENT-RUNTIME-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:aa667f066143a6b510b08bb9bdda7782c1ba1c10bbfe68e971c4ef1cd2728561
spec_mode: reverse_spec


# Behavior Rules Spec: agent-runtime

## Purpose and scope

This contract records current observable behavior of the runtime adapters, provider turns, discovery caches and subprocess transports. Source and test links are evidence; tests were read, not executed. Public signatures and composition examples are in [api.spec.md](api.spec.md).

## Precedence and ordering

- WHEN required and optional argument objects contain the same field, the composed provider/session options shall use the required field.
- WHEN `runProviderToolTurn` receives an adapter `end` event, its returned `stopReason` shall prefer that reason over the adapter's raw `stopReason`/`finishReason`.
- WHEN `unionModels` merges catalogs, it shall retain all fallback rows and metadata in original order, including existing fallback duplicates, then append the first live row for each unseen exact ID. Neither input array shall be mutated.
- WHEN `mergeModelOptions` merges catalogs, it shall visit fetched rows before suggestions, trim IDs/labels, discard blank IDs, retain the first row for each trimmed ID, and replace blank labels with IDs. This differs deliberately from `unionModels`.
- WHEN a concrete model is supplied to `resolveModelForAgent`, it shall return that value. For null/`default`, it shall consult the def's environment override first; then preserve the value if the def supports `default`; otherwise choose the first remembered live ID, first fallback ID, or original value.
- WHEN `spawnEnvForAgent` composes a child environment, it shall expand string configuration values, perform the platform proxy-aware merge, apply built-in CLI housekeeping, call `perAgentEnv`, then call `sandboxOverlay`. The overlay's result shall be final. The package shall not impose a secret allowlist on the supplied base environment.
- WHEN `applyAgentLaunchEnv` builds PATH, it shall order the Node binary directory, launch-prepend directories, existing PATH entries, and appended toolchain directories; it shall deduplicate normalized paths and preserve the existing case of the PATH key.
- WHEN an ACP session starts, it shall perform initialize, session/new or session/load, applicable model/config selection, then session/prompt. WHEN a pi parent session is supplied, it shall await its new_session acknowledgement before sending the prompt.
- WHEN batch detection completes, it shall return registry order. WHEN streaming detection yields results, it shall yield probe completion order and update remembered live models incrementally.
- WHEN built-in provider loops execute a batch of tools, they shall await execution in call order. OpenAI/Azure shall send all tool replies before one follow-up user message carrying result images. Google shall preserve opaque thought signatures on function-call continuation parts.

Evidence: [cache](../../src/model-catalog-cache.ts), [model helpers](../../src/models.ts), [environment](../../src/env.ts), [provider turns](../../src/providers/tool-turn.ts), [cache tests](../../src/__tests__/model-catalog-cache.test.ts), [turn tests](../../src/providers/__tests__/tool-turn.test.ts).

## Guards and failure boundaries

- IF an ACP native-tool permission handler is missing, rejects, throws, cancels, or selects an option absent from the offered list, THEN the session shall fail closed rather than approve the action. Native CLI permission flags remain a separate mechanism: adapter build options default to bypass where the def implements that mode; the host must explicitly choose restricted mode where supported.
- WHEN the role guard recognizes a lowercase line-boundary `## user`, `## assistant`, `## assist`, or `## system` followed by a non-lowercase character, it shall mark that message contaminated and suppress subsequent text. It shall hold an ambiguous marker suffix across chunks. Title-case headings, ordinary inline text and chat-style `User:` labels shall not be matched. The guard itself shall not kill a process.
- IF a provider loop detects contamination, THEN it shall stop its turn with `contaminated`. Built-in loops shall emit at most one end event; custom adapters are responsible for their own event cardinality.
- IF a base URL is invalid, uses a non-HTTP scheme, or names blocked literal address space, THEN validation shall return an error. Loopback shall be allowed for local providers.
- WHEN DNS lookup succeeds, validation shall reject any blocked resolved address and return the first allowed address as the pin. IF the required injected lookup throws or returns no addresses, THEN validation shall return a forbidden error without a parsed URL or pin, preventing an unvalidated fallback request.
- WHEN provider turn runners use their default transport, they shall dial the validated pin, preserve the original Host/TLS hostname, reject 301/302/303/307/308 redirects and reject compressed responses. `pinnedFetch` alone shall not validate the destination; the caller must validate first.
- WHEN model-list and connection-test helpers send requests, they shall use global fetch. Model listing shall refuse redirects; connection testing shall retain fetch's default redirect behavior. Their DNS validation result's pin shall not be forwarded to that transport. A host needing enforced address pinning must supply a suitable dispatcher or use the validated pinned transport directly.
- WHEN Google schema helpers adapt tool input, they shall strip unsupported keys, expand local `$defs` references to depth four, convert `oneOf` to `anyOf`, simplify unsupported shapes and stringify numeric enums. The neutral turn wrapper shall restore numeric-enum strings along discovered schema paths before host tool execution. This adaptation shall not replace host input validation.
- IF Azure's neutral wrapper lacks a base URL, THEN it shall emit error and end/error and return `{stopReason: 'error', toolTurns: 0}` before calling its adapter.
- WHEN tool results contain images, the neutral wrapper shall preserve image payloads for model feedback while emitting text descriptions such as `[image: image/png]` to its event consumer.
- WHEN pi receives an extension UI confirm request, it shall reply confirmed true; for selection/input/editor requests it shall choose the first available option or cancellation. This automatic extension-UI response is not the ACP native-tool permission policy.

Evidence: [permissions](../../src/agent-protocol/acp/session.ts), [role guard](../../src/role-marker-guard.ts), [network guard tests](../../src/providers/__tests__/connection-guard.test.ts), [model listing](../../src/providers/model-catalog.ts), [schema](../../src/providers/google-schema.ts), [image tests](../../src/providers/__tests__/tool-turn-images.test.ts).

## Defaults, limits and timeouts

| Surface | Current default or bound | Enforcement |
|---|---|---|
| ModelCatalogCache | 300,000 ms TTL; finite and nonnegative | Constructor rejects invalid TTL; expiry measured from discovery start |
| AmrModelLoadingCache | 600,000 ms refresh interval | Stale remote read triggers background refresh; constructor does not validate interval |
| Provider tool loops | Eight tool-feedback rounds | `maxToolTurns` uses nullish default; callers must supply valid finite bounds |
| Neutral Anthropic maxTokens | 8,192 | Wrapper supplies when omitted; direct Anthropic runner requires maxTokens |
| OpenAI/Azure maxTokens | 8,192 when omitted/nonpositive | Request body always contains a token-limit field |
| Direct provider base URL | Anthropic `https://api.anthropic.com`; OpenAI `https://api.openai.com`; Google `https://generativelanguage.googleapis.com`; Ollama `https://ollama.com` | Azure requires an endpoint; local Ollama requires an explicit baseUrl |
| Google/Ollama output-token controls | Omitted when caller does not supply them | Google maxOutputTokens / Ollama num_predict; no common token default |
| Anthropic wire version | `2023-06-01` | Default header |
| Azure wire version | `2024-10-21` | Deployment endpoint query; neutral wrapper uses adapter default |
| Model catalog / connection probe | 12,000 ms each | Request abort timer; DNS validation precedes this timer |
| pinnedFetch | 300,000 ms socket inactivity | Does not impose total-duration deadline; caller signal can abort earlier |
| Detection version / capability help | 3,000 ms / 5,000 ms | Version timeout overridable by def; capability probe maxBuffer 4 MiB |
| ACP model probe | 15,000 ms default, 24-hour ceiling | Resolved timeout governs subprocess discovery |
| ACP session stage | 600,000 ms inactivity | Reset on inbound lines; nonpositive stageTimeoutMs disables watchdog |
| ACP session identity / encoding | clientName agent-runtime; clientVersion runtime-adapter; envFormat array; executionProfile filesystem | Host can override optional session controls |
| pi session | No turn deadline | Default post-completion termination grace 5,000 ms; environment override `PI_GRACEFUL_SHUTDOWN_MS` |
| pi prompt images | Ten images, 20 MiB aggregate | Realpath containment under uploadRoot; permitted image extensions; rejected files skipped |
| Provider tool-result images | Anthropic base64 ceiling ceil(10 MiB × 4/3); OpenAI/Azure/Google ceil(20 MiB × 4/3) | Encoded character guard; OpenAI/Azure reject over 1,500 total content parts; Google has no count cap; Ollama has no image size cap |
| PendingAuthCache | 600,000 ms TTL | One-shot consume through delegated OAuth cache |
| OAuth callback listener | 1,800,000 ms | Self-closes on consuming callback or timeout; stop is idempotent |
| OAuth token expiry | 120,000 ms skew | Expired when expiresAt − skew ≤ now; absent expiry is treated as non-expiring |
| ElevenLabs catalog | Ten-minute TTL; limit 100, clamped 1–100; 15,000 ms fetch timeout | Per-workspace/endpoint/limit/credential cache; first page only |
| Custom model ID | 1–200 characters after trim | Starts alphanumeric; remaining characters limited to letters, digits, `._/:@-` |
| Prompt argv | Def-specific Windows budget; POSIX max(def budget, 100,000 bytes) | Returns budget error above bound; only defs declaring an argv bound participate |
| Windows assembled command line | 32,511 characters for shim and direct executable | 32,767 CreateProcess ceiling less 256 headroom; includes transport-specific quoting |

IF a provider returns the recognized HTTP 400 unsupported `max_tokens` error, THEN the OpenAI-compatible request mechanism shall retry once with `max_completion_tokens` where a retry body is available. The package shall not retry arbitrary tool executions or guarantee turn idempotency.

## Deliberate exclusions and known drift

The package shall not provide a durable run queue, distributed cache, automatic cache eviction, host authorization policy, tool registry/executor implementation, tenant resolution, chat-history persistence, browser sign-in navigation, CLI installation, or an application server. PromptAugmenter, ArtifactTaxonomy and TelemetrySink are contracts/defaults; exporting them does not assemble a run orchestrator. Registry detection is a snapshot, not a guarantee that a later CLI launch succeeds. SSE decoding supplies no reconnect, replay, frame size bound or application backpressure policy.

`SpawnEnvHooks.perAgentEnv` runs after housekeeping and before the sandbox overlay. `validateBaseUrlResolved` requires an injected resolver and fails closed on lookup failures or empty answers. `modelCatalogCacheKey` accepts unknown variants at its boundary but throws `TypeError` for non-string values before trimming; omitted or undefined variants retain the empty-string default.

Decision rationale: [Provider adapters preserve native continuation and tool events](../decisions/DR-001-provider-native-tool-lifecycle.md).
