# `@jini/memory` — provenance

**New package, not yet in the locked §3 package set in
`foundry/docs/jini-port/extraction-plan.md`.** Same precedent as `@jini/deploy` and
`@jini/registry`: flagged here for Coordinator/Software-Architect sign-off
before being folded into the locked list.

Built per the task-6 audit's PART B brief off `foundry/docs/jini-port/recon/
r1-daemon.md`'s TASK 1 MIXED classification for the daemon's top-level
`memory*.ts`: "memory subsystem... generic capability with OD-shaped
payloads." This is the daemon-side backend capability (extraction/rules/
verification), a completely different thing from `packages/ui/src/features/
memory/`'s `MemorySection.tsx` (the frontend presentation layer, ported
separately in an earlier session).

## Discrepancy in the task brief, flagged rather than silently resolved

The task brief named 7 files: `memory-cleanup.ts`, `memory-connectors.ts`,
`memory-extractions.ts`, `memory-llm.ts`, `memory-rules.ts`,
`memory-verify.ts`, `memory.ts`. On a fresh clone of `leonaburime-ucla/
open-design`'s `refactor/web-memory-slice` branch (the branch the recon doc
itself was written against) and a full-history search (`git log --all
--oneline -- '**/memory-cleanup.ts'` across every branch), **`memory-
cleanup.ts` does not exist anywhere in the OD repository.** Only 6 of the 7
named files are real. This source-map documents what was actually read and
ported/skipped for those 6 — `memory-cleanup.ts` is not addressed because
there is nothing to address.

## Read all 6 files in full; classification per file (not one blanket verdict)

The recon's "generic capability with OD-shaped payloads" description turned
out to fit **only about a third** of this directory's actual content once
read end-to-end. The rest is materially more OD-product-specific than a
one-line recon summary could capture — memory type taxonomies, an
OpenDesign-branded connector-mining assistant, and coding-agent-CLI process
execution, not just "payload shape."

| Origin file | Verdict | Why |
|---|---|---|
| `memory.ts` | **Split: generic mechanism ported, OD payload/business-logic left behind** | See "What was ported" below. |
| `memory-extractions.ts` | **Ported in full**, as `src/extraction-log.ts` | Already fully generic in the origin — verified zero `@open-design/*` imports; its only coupling was importing `memoryEvents` from `memory.ts`, replaced with the log's own independent `EventEmitter`. |
| `memory-verify.ts` | **Ported: pure algorithm + record log**, as `src/verify.ts` | `enforceVerify`'s rule-coverage matching (`rowCoversRule`, `significantWords`, the STOPWORDS list) is a generic "does this row's text cover this rubric item" algorithm with zero OD content. Its one real coupling — extracting a scorecard from output text via OD's `<od-card type="verify-scorecard">` markup (`splitOnOdCards` from `@open-design/contracts`) — was generalized into a host-supplied `extractScorecard: (output: string) => VerifyScorecard \| null` callback instead of a hardcoded parser. |
| `memory-connectors.ts` | **NOT ported — correctly OD-product, not "generic with OD payload"** | This is an OpenDesign-branded connector-mining assistant: a ~30-pattern regex list of *design-specific* vocabulary (`design system`, `figma`, `typography`, `dark mode`, Chinese design terms) used to filter what counts as "design-relevant," a system prompt literally titled "You are a design-memory extractor for OpenDesign connected-app context," and Notion-specific page-opening heuristics. There is no generic "connector fact-mining" mechanism left over once the design-topic filtering and OD branding are removed — the whole file *is* that filtering. Skipped, not forced. |
| `memory-llm.ts` | **NOT ported — deeply OD-coupled, not cleanly separable in this pass** (later partially revisited — see below) | Three intertwined concerns: (1) a genuinely generic "call one of N LLM HTTP APIs with a system+user prompt, parse strict JSON" sub-pattern (`callAnthropic`/`callOpenAI`/`callAzure`/`callGoogle`) — a real future extraction candidate, noted here for whoever picks this up next; (2) OD-branded system prompts ("personal AI design assistant") and memory-config provider-override shape; (3) local coding-agent-CLI execution (`claude`/`codex`/`opencode` one-shot invocation via `@open-design/platform`'s `createCommandInvocation`, agent env building) that has nothing to do with memory extraction generically — it's "run one of OD's supported coding CLIs headlessly." Attempting to port this file in the time available for this task risked exactly the failure mode called out in the audit-lessons section of the task brief (a declared port whose implementation doesn't hold up); skipped rather than forced. Concern (1) — the flagged "real future extraction candidate" — was picked up and ported on 2026-07-21; see that dated addition below. Concerns (2) and (3) remain NOT ported, unchanged from this original verdict. |
| `memory-rules.ts` | **NOT ported — thin wrapper entirely dependent on the skipped `memory-llm.ts`** | `distillRulesFromAnnotations`'s heuristic pass is a few lines of generic templating, but its LLM pass calls `suggestWithLLM` from the skipped `memory-llm.ts`, and its system prompt is OD-specific ("distil a designer's review annotations..."). Not portable independent of the file above. |

## What was ported from `memory.ts`

The filesystem fact-store *mechanism* — frontmatter-backed entry files, a
human-editable `INDEX.md` of link bullets as the "active set" source of
truth, a minimal `.config.json`, change events, deterministic id derivation
(slugify + FNV-1a hash fallback for non-ASCII names) — is genuinely generic
and was ported as `src/note-store.ts` (`createNoteStore`). **Not ported**
(left as OD product/business logic, not mechanism):

- **The type taxonomy itself.** OD's `MEMORY_TYPES` (`profile`/`user`/
  `feedback`/`project`/`reference`/`rule`) is a fixed, OD-chosen bucket set
  imported from `@open-design/contracts`. Generalized into
  `NoteStoreConfig.validTypes`/`defaultType` — entirely host-supplied.
- **`composeMemoryBody`** (prompt-composition rendering: profile as a
  structured key/value block, rules as a verify-rubric, others as
  `**name** — description` bullets) — this is OD's specific system-prompt UX
  for *how* memory gets injected into a chat turn, not a store capability. A
  host composes its own prompt from `listActiveEntries`/`readEntry`.
- **`listActiveRuleEntries`** — a one-line OD-specific wrapper (`rule`-type
  filter over the active set) now trivially expressible by a host as
  `(await store.listActiveEntries(dataDir)).filter(e => e.type === 'rule')`.
- **The onboarding→profile capture** (`captureProfileFromForm`,
  `parseFormAnswers`, `CANONICAL_PROFILE_LABELS` — OD's specific discovery-
  form field labels like "Organization size"/"Aesthetic / taste") — OD
  product UX, not a store concern.
- **The heuristic regex extraction pack** (`REMEMBER_PATTERNS`,
  `extractFromMessage`) — this is content classification ("does this
  sentence mean 'remember this'?"), not a reusable mechanism; the English/
  Chinese trigger phrases are themselves the entire value of the file.
- **`maskMemoryExtractionConfig`** and the `.config.json` extraction-
  provider-override fields (`chatExtractionEnabled`/`profileEnabled`/
  `rewriteEnabled`/`verifyEnabled`/`extraction`) — these are OD chat-hook
  toggles paired 1:1 with the skipped `memory-llm.ts`/onboarding features.
  The ported config keeps only the generic on/off master switch (`enabled`).

**One deliberate design change beyond de-branding:** the origin's `memory.ts`
shared one module-level `EventEmitter` (`memoryEvents`) across every call
site, which only worked because OD ran exactly one memory store per daemon
process. `createNoteStore`/`createExtractionLog`/`createVerifyLog` are
factories that each return their own independent `EventEmitter` instance, so
multiple stores in one process (or in tests) never cross-fire events.

## `entry-frontmatter.ts` — a new, narrower helper, not the ported
`design-systems/frontmatter.ts`

The note-store entry format needs exactly three flat scalar frontmatter
fields (`name`/`description`/`type`) plus a body. OD's actual frontmatter
parser (`apps/daemon/src/design-systems/frontmatter.ts`) is a fuller
YAML-subset parser (nested objects, arrays, block-literal `|` strings) that
belongs to the `design-systems/` subsystem — a different area, out of this
task's brief (registry/memory/services/migration), and porting the whole
subsystem to satisfy one small caller would be scope creep. `entry-
frontmatter.ts` is a small, self-contained, purpose-built parser/renderer
for exactly the note-store's shape — not a copy or subset extraction of the
design-systems parser, and not a duplicate of it (different scope, no
shared code).

## Dependencies

None beyond Node builtins (`node:fs/promises`, `node:path`, `node:events`,
`node:crypto`).

## Barrel branch reconciliation (`memory-capability-barrel`, 2026-07-18)

A later task re-checked this package against OD's `memory-capability-barrel`
branch. That branch decomposes the same 6 files this package was already
ported from (`memory.ts`, `memory-extractions.ts`, `memory-verify.ts`,
`memory-llm.ts`, `memory-rules.ts`, `memory-connectors.ts`) into a `memory/`
capability-barrel directory (`core/`, `store/`, `extractions/`, `verify/`,
`llm/`, `rules/`, `connectors/`), per its own `apps/daemon/src/memory/
README.md`: "The moves were purely structural — no logic changes."

Verified independently rather than trusted, because `memory-capability-barrel`
and this package's original `refactor/web-memory-slice`-based port are two
different OD branches/points in time and "no logic changes" is exactly the
kind of claim worth checking: diffed each already-ported file against the
*true* pre-refactor version at the branch's own merge-base with `main`
(`0b88ef561`, not `main`'s current tip — `main` has since gained unrelated
`memory.ts` changes, e.g. a `MemoryEntrySource` field and
`isHeuristicExtractionArtifact`/`pruneProfileBodyToCanonical` helpers, that
post-date `memory-capability-barrel`'s fork point and are simply not present
on that branch; comparing against `main`'s tip would have produced false
"missing" signals unrelated to the actual refactor).

- **`store/store.ts`** vs. `memory.ts` at the merge-base: after stripping
  comment-only lines, the only diff is import-path changes and the
  `memoryEvents`/`MemoryChangeKind`/`MemoryChangeEvent` relocation into
  `core/events.ts` — zero function-body changes. Already fully covered by
  this package's existing `note-store.ts` mechanism-port + the documented
  "not ported" list (type taxonomy, `composeMemoryBody`,
  `listActiveRuleEntries`, onboarding capture, heuristic regex pack,
  `maskMemoryExtractionConfig`/config-override fields).
- **`extractions/extractions.ts`** vs. `memory-extractions.ts` at the
  merge-base: the only diff, stripped of comments, is the single
  `memoryEvents` import path. Already fully covered — this package's
  `extraction-log.ts` is a full port.
- **`verify/verify.ts`** vs. `memory-verify.ts` at the merge-base: same —
  only the `memoryEvents` import path differs. Already fully covered —
  this package's `verify.ts` is a full port (pure algorithm + record log).
- **`connectors/connectors.ts`**, **`llm/llm.ts`**: re-read in full on the
  barrel branch; still OD-branded throughout (`OpenDesign`/`Open Design`
  literal strings in system prompts and comments still present, e.g.
  `connectors/connectors.ts`'s `CONNECTOR_MEMORY_SYSTEM_PROMPT` and its
  design-topic regex list). Confirms the original NOT-ported verdicts.
  `llm/llm.ts`'s `callAnthropic`/`callOpenAI`/`callAzure`/`callGoogle` remain
  private (non-exported) helpers entangled with `pickProvider`'s
  agent-CLI-selection logic — not independently extractable without a larger
  refactor than this reconciliation pass's scope, confirming the original
  "not cleanly separable" verdict.

**One genuinely new, generic, OD-noun-free piece found and ported:**
`rules/rules.ts`'s exported `parseRuleBody` function (`git grep parseRuleBody`
on the branch shows it exported from the domain root barrel alongside
`distillRulesFromAnnotations`). It parses a rule note body's labeled lines
(`Assertion:`/`Check:`/`Verified by:`/`Rationale:`) into
`{ assertion, check, rationale }` — pure text parsing, zero product nouns,
and — unlike the rest of `rules.ts` — has no call-site coupling to
`suggestWithLLM`, annotations, or any OD type. The original pass's verdict on
`memory-rules.ts` ("thin wrapper entirely dependent on the skipped
`memory-llm.ts`") was about `distillRulesFromAnnotations`, the file's other
export; it did not separately call out `parseRuleBody`, which turns out to be
a standalone leaf with no such dependency. It also has a direct, motivated
integration point already ported in this package: `verify.ts`'s
`ActiveRuleForVerify.check` is a host-supplied field with no built-in way to
derive it from a stored rule entry's raw body — `parseRuleBody` is exactly
that derivation. Ported as `src/rule-body.ts` (`parseRuleBody`,
`ParsedRuleBody`), re-exported from `index.ts`, tests in
`__tests__/rule-body.test.ts`, 100% coverage on all 4 metrics.

No other new generic pieces were found. `memory-connectors.ts`/`memory-llm.ts`/
`memory-rules.ts`'s remaining exports stay un-ported for the same reasons
recorded in the classification table above; nothing in the barrel's
structural move surfaced content the original `refactor/web-memory-slice`-based
read had missed, beyond `parseRuleBody`.

## 2026-07-21 addition — `llm-provider.ts` (the `memory-llm.ts` concern-(1) carve-out, `feat/http-routes-and-cli-commands`)

Picked up the classification table's own flag on `memory-llm.ts`: concern (1),
"a genuinely generic 'call one of N LLM HTTP APIs with a system+user prompt,
parse strict JSON' sub-pattern... a real future extraction candidate, noted
here for whoever picks this up next." Re-verified against
`leonaburime-ucla/open-design`, branch `refactor/web-memory-slice`, via
`git show refactor/web-memory-slice:apps/daemon/src/memory-llm.ts` (1391
lines) — read in full again rather than trusting the earlier pass's summary,
per this task's own brief that the three concerns are "intertwined," not
cleanly pre-separated. That re-read confirms the earlier verdict on concerns
(2)/(3) and confirms concern (1) genuinely does separate out cleanly once the
provider-object shape is generalized from OD's `pickProvider`-constructed
object (which carries OD-only fields like `credentialSource`/`transport`/
`agentId`) down to just what the four HTTP-call functions themselves
actually read (`baseUrl`/`apiKey`/`model`/`apiVersion`). The barrel-branch
reconciliation note directly above, which called these four functions "not
independently extractable without a larger refactor," was evaluated against
a narrower bar (extracting them with zero refactor, from inside
`pickProvider`'s closure); extracting them as a new caller-configured module
instead of trying to lift them in place is exactly that refactor, and turned
out to be straightforward — the four functions never actually touch any
OD-specific state themselves, only the shape of the object handed to them.

| Jini file | Origin file:line (`refactor/web-memory-slice`) | Transform |
|---|---|---|
| `src/llm-provider.ts` | `callAnthropic` L681-708, `callOpenAI` L710-745, `callAzure` L752-784, `callGoogle` L791-819, plus the shared `appendVersionedApiPath` L614-621, `withTimeout` L626-633, `describeFetchError` L646-679 plumbing, and the fence-stripping/parse-with-fallback half of `parseEntries` L1011-1029 (stops short of L1030's `entries`/`MEMORY_TYPES` schema validation) | See below — generalized, not lifted verbatim; every origin option that was a fixed OD choice (which model, which vendor, when to fall back) became caller-supplied, and every option that was a real HTTP-call parameter (`baseUrl`/`apiKey`/`model`/`apiVersion`/headers/timeout) became a field on the new `LlmProviderConfig`. |

**What was ported, precisely.** `callLlmProvider(config: LlmProviderConfig, systemPrompt, userPrompt): Promise<string>` dispatches on `config.provider` (`'anthropic' | 'openai' | 'azure' | 'google'`) to one of four internal functions that are a direct behavioral port of the origin's `callAnthropic`/`callOpenAI`/`callAzure`/`callGoogle` — same URLs, same headers, same request bodies, same response-field extraction (`content[].find(type==='text').text` for anthropic, `choices[0].message.content` for openai/azure, `candidates[0].content.parts[].text` joined for google), same `response_format: 'json_object'` / `responseMimeType: 'application/json'` strict-JSON-forcing per vendor. `appendVersionedApiPath` (anthropic/openai's `/v1/<resource>` URL-building, avoiding a doubled `/v1/v1/...` against a proxy whose saved base URL already has a version segment) and `describeFetchError` (unwrapping undici's generic `TypeError: fetch failed` down to the OS error code/inner cause) are both ported near-verbatim as exported utilities, with the same branch behavior (including the AggregateError inner-errors fallback loop). `parseStrictJson<T>(rawText): T` ports `parseEntries`'s fence-stripping-then-`JSON.parse`-with-`{...}`-block-fallback mechanics — but stops exactly where that function's memory-specific schema validation begins (`Array.isArray(parsed?.entries)` and the `MEMORY_TYPES` filter), throwing instead of that function's `return []` so a generic caller gets an explicit, catchable failure rather than a silently-empty result that only made sense in the entries-list context. `callLlmProviderForJson<T>` is a new (not in the origin) one-call convenience wrapping the two.

**What was NOT ported — the other two-thirds, unchanged from the original verdict:**
- **Provider auto-selection** (`pickProvider`, `PROVIDER_DEFAULTS`, `envKeyFor`, `chatProtocolFromAgentId`, `canUseLocalCliForMemory`, `localCliProviderFor`) — the 0-through-7 fallback chain (memory-config override → local CLI → chat-protocol env var → BYOK chat-config snapshot → legacy env fallbacks → media-config OpenAI key borrow → skip) is entirely OD product policy about *which* vendor/model/credential to prefer and why, encoding OD-specific concepts (`chatAgentId`, "Same as chat," a memory `.config.json` extraction override, media-config credential borrowing) that have no engine-level meaning. A `Jini` host supplies a fully-resolved `LlmProviderConfig` directly; deciding how to arrive at one is 100% host policy.
- **The two OD-branded system prompts** (`SYSTEM_PROMPT`, `ANNOTATION_SYSTEM_PROMPT`) — "You are a memory extractor for a personal AI design assistant" / "You are a memory distiller for a personal AI design assistant," plus their `entries[].type` taxonomy tied to OD's `MEMORY_TYPES` (`user`/`feedback`/`project`/`reference`/`rule`). A caller of `callLlmProvider`/`callLlmProviderForJson` supplies its own system prompt string outright — this module has zero prompt content of its own.
- **The `entries`/`MEMORY_TYPES` schema validation** inside `parseEntries` (L1030-1046) — filtering an array of candidate objects against OD's fixed type enum, capping at 6, is memory-domain schema, not a JSON-parsing mechanism. A caller of `parseStrictJson<T>` validates its own shape.
- **The memory-config provider-override resolution** (`readMemoryConfig(dataDir).extraction`, the `.config.json` override shape with `provider`/`model`/`baseUrl`/`apiKey`/`apiVersion`) — an OD persistence/settings-UI concern layered on top of `pickProvider`, not a call-time HTTP concern.
- **Local coding-agent-CLI execution** (`callLocalCli`, `canUseLocalCliForMemory`, `LOCAL_CLI_TIMEOUT_MS`, the `claude`/`codex`/`opencode` one-shot subprocess spawning via `@open-design/platform`'s `createCommandInvocation`, `extractJsonEventText`/`createJsonEventStreamHandler` event-stream parsing) — this is "run one of OD's supported coding CLIs headlessly and scrape its stdout," a completely different transport (local subprocess, not an HTTP API) with no relationship to calling a vendor's REST endpoint. Confirmed again on this re-read: none of it is reachable from, or needed by, the four HTTP-call functions.
- **Everything downstream of a raw/parsed LLM response** — `collectProposedEntries`'s dedup-by-turn-signature, `alreadyKnown`/`toMemoryDraft`, `suggestWithLLM`/`extractWithLLM`/`distillAnnotationsToMemory`, the extraction-attempt-log wiring (`startExtraction`/`markProvider`/`markSuccess`/etc., already ported separately as `src/extraction-log.ts`) — all memory-domain orchestration, out of scope for a "call an LLM, get JSON back" primitive.

**Design decisions beyond straight translation:**
- **Per-vendor default `baseUrl`s kept, but only the three with a real public host.** `anthropic`/`openai`/`google` default to that vendor's actual public API host when `baseUrl` is omitted (the same three URLs the origin's `PROVIDER_DEFAULTS` hardcoded) — this isn't an OD opinion, it's just "what `api.anthropic.com` is." `azure` has no public host (every tenant has its own `<resource>.openai.azure.com`) and throws a clear error if `baseUrl` is omitted, matching the origin's own "Azure with no resource URL is unrecoverable" guard.
- **No default `model`.** The origin's `PROVIDER_DEFAULTS` also picked a default *model* per vendor (`claude-haiku-4-5`, `gpt-4o-mini`, `gemini-3.5-flash`) — that's a product cost/quality tradeoff, not an HTTP-call detail, so it was deliberately dropped; `model` is always caller-required here.
- **`extraHeaders` generalizes the origin's single hardcoded AIHubMix special case.** `callOpenAI` had one `provider.kind === 'aihubmix' ? {'APP-Code': AIHUBMIX_APP_CODE} : {}` branch, wiring one specific OD-integrated gateway's attribution header directly into the shared function. Generalized into a caller-supplied `extraHeaders?: Record<string,string>` merged under (never over) this module's own auth/content-type headers — any gateway/proxy attribution header a host wants, without this module knowing any vendor names beyond the four core wire shapes.
- **`AZURE_DEFAULT_API_VERSION` kept as an engineering default, not treated as an OD opinion to strip.** Mirrors `packages/media/src/dispatch/openai-compatible.ts`'s existing `AZURE_DEFAULT_API_VERSION` precedent in this same repo (a different constant value, `2024-02-01`, for a different Azure surface) — an Azure API-version string is a wire-protocol detail every Azure OpenAI-compatible caller needs, not a product choice about which model to prefer.
- **`max_tokens: 1024` (anthropic) kept as an internal constant, not surfaced as a new config option.** The origin hardcoded it rather than exposing it as configurable; surfacing it as caller-configurable would be new API surface the origin never had, not a generalization of something that already varied.
- **The success/error JSON-parsing path was consolidated into one shared `postJson` helper** used by all four vendor calls (the origin repeated near-identical fetch/status-check/`resp.json()` blocks four times) — same behavioral contract (non-2xx → `Error('<tag> <status>: <body>')`, non-JSON 2xx body → `Error('<tag> non-JSON response: <body>')`, matching this repo's existing `parseOpenAICompatibleJson` pattern in `packages/media/src/dispatch/openai-compatible.ts`), not a capability change — DRY between vendors, not a behavior cut.

Tests: `src/__tests__/llm-provider.test.ts` — 56 tests, **100% coverage on all 4 metrics** (statements/branches/functions/lines) on `llm-provider.ts`, covering: every vendor's URL/header/body construction and default-vs-custom `baseUrl`/`apiVersion`, the `appendVersionedApiPath` doubled-`/v1` guard in both directions, every `describeFetchError` branch (plain message, non-Error throw, null/non-object/empty-object cause, code-only, message-only, duplicate-of-head message, code-contains-message-dedup vs. code+message-both-shown, the `AggregateError`-style `errors[]` fallback loop finding a candidate on a later entry vs. exhausting with none vs. a non-array `errors` field), every `parseStrictJson` branch (direct parse, non-object JSON values, both fence styles, regex-fallback success, regex-fallback-found-but-still-invalid, no-braces-at-all, truncated vs. untruncated error previews), config validation (empty/whitespace `apiKey`/`model`, azure-without-`baseUrl`, an unrecognized provider id via a type-bypassing cast — a defensive runtime guard exercised deliberately since this package ships plain JS too), `extraHeaders` unable to clobber required auth headers, `requestInit` passthrough with explicit fields still winning, `timeoutMs` default/custom/`NaN`/non-positive resolution (verified via `vi.spyOn(AbortSignal, 'timeout')`, matching this repo's established real-fetch-mock testing style rather than asserting on internal state), a network-level fetch rejection routed through `describeFetchError`, an empty-200-body response, and both `callLlmProviderForJson` success and JSON-parse-failure propagation.

Dependencies: none beyond Node/web-standard builtins already available in this package's runtime target (global `fetch`, `Response`, `URL`, `AbortSignal.timeout` — Node `~24` per the repo's `engines` field, matching the precedent already set by `packages/media`'s provider files calling `AbortSignal.timeout` directly with no polyfill).

## 2026-07-21 addition — `extract-facts.ts`, the generic extraction pipeline `llm-provider.ts` was ported to support

Closes the gap the `llm-provider.ts` addition above flagged implicitly: that
module is only the "call an LLM HTTP API, get strict JSON back" primitive —
it was never itself an extraction pipeline. This addition is that pipeline:
`extractFacts(llmConfig, { content, sourceLabel? }, options?)` calls
`callLlmProvider` with a generic extraction-shaped system+user prompt, then
`parseStrictJson` + sanitizes/validates the model's response into
`ExtractedFact[]` (`{ statement, category?, entities?, confidence?,
sourceQuote? }`).

**Why this is safe to build now, unlike the pieces still left un-ported.**
Re-read this package's own classification table above before writing any
code, specifically to re-confirm which of the origin's un-ported pieces this
new work must NOT reintroduce, and why each was excluded in the first place:

- **`memory-connectors.ts` (NOT ported: OD-branded connector-mining)** — its
  exclusion reason was "there is no generic 'connector fact-mining'
  mechanism left over once the design-topic filtering and OD branding are
  removed — the whole file *is* that filtering." `extract-facts.ts` has no
  topic filter of any kind — every piece of `content` a caller hands it is
  extracted from as given, with no "is this design-relevant?" gate. Nothing
  from that file was reused or reintroduced.
- **`memory-llm.ts` concerns (2)/(3) (NOT ported: OD system prompts +
  coding-agent-CLI transport)** — concern (2) was OD's product copy
  ("personal AI design assistant") tied to a fixed `MEMORY_TYPES` taxonomy;
  concern (3) was local subprocess execution, a different transport
  entirely. `extract-facts.ts`'s `DEFAULT_SYSTEM_PROMPT` names no
  product/assistant identity and has no fixed category enum
  (`ExtractedFact.category` is a free-form string; the model chooses it,
  optionally steered by a caller-supplied `suggestedCategories` *hint*,
  never an enforced/rejecting filter) — and it only ever calls
  `callLlmProvider`, the HTTP-only primitive concern (1) already ported.
  Concerns (2)/(3) stay un-ported, unchanged.
- **`memory-rules.ts` (NOT ported: thin wrapper over the skipped LLM
  concerns)** — irrelevant here; this addition has no relationship to rule
  distillation.
- **`memory.ts`'s dropped pieces** (`MEMORY_TYPES` taxonomy,
  `composeMemoryBody`, the heuristic regex pack, `maskMemoryExtractionConfig`)
  — none reused. In particular, no fixed type taxonomy was reintroduced:
  {@link factToNoteDraft} (see below) takes `type` as a caller-supplied
  parameter, exactly matching `note-store.ts`'s own already-established
  `NoteStoreConfig.validTypes`/`defaultType` host-supplied-taxonomy
  pattern — this module derives `type` from nothing of its own.

**What was built, precisely** (`packages/memory/src/extract-facts.ts`, no
OD origin — new work assembled from the already-ported `llm-provider.ts`
primitives, same category of "new design work" as `packages/deploy/src/
tool.ts` was for its own package):

- `extractFacts(llmConfig, input, options?)` — the pipeline itself. Empty/
  whitespace-only `input.content` short-circuits to `{ facts: [], raw: '' }`
  with no network call. Builds a user prompt folding in `input.sourceLabel`
  (free text, never a taxonomy value) and `options.prompt.suggestedCategories`
  (a hint), calls `callLlmProvider` with `DEFAULT_SYSTEM_PROMPT` (or a
  caller override via `options.prompt.systemPrompt`), then
  `parseStrictJson`s the response and sanitizes each candidate: drops any
  candidate with no usable `statement`, drops non-string `entities` and
  omits an empty `entities` array entirely, clamps `confidence` to `[0, 1]`
  and drops it if non-numeric, trims/drops empty `category`/`sourceQuote`,
  and caps the result at `options.prompt.maxFacts` (default
  `DEFAULT_MAX_FACTS = 20`, matching the same order of magnitude as the
  origin's own cap of 6 for a narrower single-turn case, scaled up for a
  potentially longer document/conversation excerpt — not copied from the
  origin, which this module has no schema/behavior tie to).
- **Optional `ExtractionLog` integration** (`options.logging: { log, kind }`)
  — when supplied, records `startExtraction` → `markProvider` →
  `markProposed` → `markSuccess`/`markFailed` through the already-ported
  `extraction-log.ts`, reusing it rather than inventing a second attempt-log
  shape. Documented explicitly (in both the option's JSDoc and an inline
  comment at the call site) that "success" here means "the extraction call
  itself succeeded," not "facts were persisted" — this module never writes
  to any store, so `markSuccess`'s `writtenCount`/`writtenIds` fields
  reflect facts *extracted*, with `writtenIds` always `[]`; a caller that
  goes on to actually persist some of the returned facts may call
  `log.markSuccess(attemptId, ...)` again with the real outcome, since
  `ExtractionLog` records are mutable/overwritable by id, not append-only.
- `factToNoteDraft(fact, type)` — a small, deliberately optional bridge to
  `note-store.ts`'s `NoteStore.upsertEntry({ name, description, type })`
  input shape, NOT a requirement for using `extractFacts`. Truncates a long
  `statement` to 80 chars for `name` (note-store names are short labels, not
  bodies), keeps the full `statement` (plus a `Source: "..."` line when
  `sourceQuote` is present) as `description`, and takes `type` as a plain
  caller-supplied parameter with no validation against any particular
  store's `validTypes` — the taxonomy is 100% the caller's, matching
  `note-store.ts`'s own already-generalized design.

**What was deliberately NOT built:** any automatic wiring from
`extractFacts`'s output into `note-store.ts` (no "extract and write" combined
function) — persistence is a policy decision (which facts to keep, under
which type, deduping against existing entries) squarely in the "caller
decision" territory this package's whole `note-store.ts` port already drew
that line around; a fixed/default category taxonomy; any topic/relevance
filter; any provider-selection policy (still the host's job via `llmConfig`,
per `llm-provider.ts`'s own already-established boundary).

**Tests:** `src/__tests__/extract-facts.test.ts`, 19 tests, **100% coverage
on all 4 metrics** on `extract-facts.ts` — empty-content short-circuit with
no network call; default-prompt call shape (system prompt, user-prompt
content/maxFacts framing); `sourceLabel`/`suggestedCategories` folded into
the prompt; full system-prompt override; every sanitize-per-candidate branch
(missing/blank statement, non-object candidate, non-string/blank entities,
empty entities array omitted entirely, confidence clamped high/low/non-
numeric, category/sourceQuote trimmed-or-omitted); non-array `facts` field
treated as zero facts; default `maxFacts` cap (20) and a caller-supplied cap
including the floor/non-positive-value fallback branches; network/HTTP-error
and invalid-JSON-response propagation (both unchanged from what
`callLlmProvider`/`parseStrictJson` themselves throw); the full
`ExtractionLog` integration (start→provider→proposed→success on success,
failed-attempt recording on both an LLM-call error and a JSON-parse error,
and "no log passed" leaving nothing to break); and `factToNoteDraft`'s
short/long/with-quote formatting branches.

**Verification:** `pnpm --dir packages/memory exec vitest run --coverage` —
204/204 tests pass; `extract-facts.ts` itself is 100/100/100/100
(statements/branches/functions/lines). Package-wide aggregate is
98.96/98.95/100/98.96, which does **not** clear this package's configured
99% global threshold (`packages/memory/vitest.config.ts`) — but this is a
**pre-existing** shortfall, not something this addition introduced: verified
by stashing this change and re-running coverage against the unmodified tree,
which already failed the same gate at 98.86/98.79/100/98.86 (the gap is
entirely `note-store.ts`'s own pre-existing uncovered lines 204-207/253-255,
untouched by this task and out of this task's scope — item 1 was scoped to
building the extraction pipeline, not auditing `note-store.ts`). Adding this
addition's fully-covered code *improved* the aggregate (98.86 → 98.96 stmts/
lines, 98.79 → 98.95 branches) rather than regressing it. `pnpm --dir
packages/memory exec tsc --noEmit` clean.

Dependencies: none beyond what `llm-provider.ts`/`extraction-log.ts` already
require (no new package dependency).

## 2026-07-22 addition — genuine 100% coverage: note-store.ts, and a missing test:coverage script (audit fix)

**Missing `test:coverage` npm script.** This package had a real `vitest.config.ts` coverage
threshold gate but no `test:coverage` script in `package.json` to actually invoke it as part of
this repo's standard per-package verification command — added (`vitest run --coverage`, matching
every other package's convention) plus the `@vitest/coverage-v8` devDependency it needs.

**`note-store.ts:170-171`** (`assertSafeSubdir`'s final guard,
`path.basename(subdir) !== subdir || path.isAbsolute(subdir)`): re-investigated rather than
trusted from the prior comment's own "unreachable on this host, verified analytically" claim.
That claim was *correct* for the platform-bound `path` import specifically — but re-deriving it
surfaced why: `node:path`'s behavior depends on the host OS, and `path.win32.basename('C:foo')`
returns `'foo'` (stripping the drive-letter prefix), so a subdir like `"C:foo"` — no `/`/`\`, so
none of the earlier checks catch it — *would* trip this guard on a real Windows host, just not on
this (POSIX) CI. Real fix, not a padded test: the check now calls `path.win32.basename`/
`path.win32.isAbsolute` explicitly, unconditionally, regardless of host OS — `path.win32` is a
strict superset of `path.posix`'s separator handling (accepts both `/` and `\`), so this doesn't
weaken anything, it just makes the validation's outcome identical on every platform instead of
silently depending on which one happens to run it. This also makes the branch directly testable
on POSIX with a real `"C:foo"` input, no `node:path` mocking required (the prior comment noted
`vi.spyOn`/`vi.mock` on `node:path` were both rejected as impractical/destabilizing — no longer
needed).

**`note-store.ts:107`** (`NoteStoreConfigError`'s constructor, `cause !== undefined ? {cause} :
undefined`): a gap not named in this task's original list but found during this pass's own fresh
coverage run — this package's two real call sites (`readConfig`'s two `throw new
NoteStoreConfigError(...)` sites) always pass a `cause`, so the "no cause" branch was untested.
Unlike `@jini/http`'s analogous `runs.ts:68` fix, `cause` was *not* made mandatory here:
`NoteStoreConfigError` is a public, barrel-exported class (`index.ts`), and an optional `cause`
parameter on a public error constructor is normal, idiomatic API surface an external consumer may
legitimately use without one — narrowing the public API to chase a coverage number would be a real
capability reduction, not a coverage fix. Two new direct construction tests instead (with and
without `cause`).

**Verified, personally, this session**: `pnpm --dir packages/memory exec tsc --noEmit`: clean.
`pnpm --dir packages/memory run test:coverage` — **212/212 tests pass** (7 new), **genuine
100/100/100/100 across every file in this package**. `vitest.config.ts`'s committed threshold
raised from 99/99/99/99 to 100/100/100/100 to lock this in.

## 2026-07-23 — composition-root consumer, no locked downward edge

The repaired R7 guard showed that `@jini/node-host` directly instantiated this still-incubating
package. The host now exposes a neutral HTTP-extension seam instead. `examples/reference-web` owns
the generic note/extraction/verification stores and registers `@jini/http`'s memory routes at the
composition root. This named workspace example does not satisfy `UNLOCKED.md`'s external
packed-consumer promotion requirement.
