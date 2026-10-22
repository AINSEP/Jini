Spec ID: SPEC-JINI-PROTOCOL-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:1e65d0e76076a84d8e118a812e54f80923154f3a03fbdc6124d9ae19ab0a0f74
spec_mode: reverse_spec


# Protocol API contract

## Purpose and entry points

`@jini-ai/protocol` exports only `.` (`src/index.ts`): wire types, registry Zod schemas, pure helpers, and adapter interfaces. It requires Zod at runtime; it requires no host services for its helpers. There are no supported deep imports.

Signatures below describe current source. The notation separates required and optional objects where source does; one-object functions and Zod methods do not accept an invented second options object. `JsonPrimitive` and `JsonValue` are imported internally from `@jini-ai/core/primitives`, not exported by protocol.

## Helpers and constants

```ts
isTerminalRunState({ state }: { state: RunState }): boolean;
encodeRunContextRef({ payload }: { payload: RunContextPayload }): string;
decodeRunContextRef({ contextRef }: { contextRef: string }): RunContextPayload | undefined;
createApiError({ code, message }: Pick<ApiError, 'code' | 'message'>, optionalArgs: Omit<ApiError, 'code' | 'message'> = {}): ApiError;
createApiErrorResponse({ error }: { error: ApiError }): ApiErrorResponse;
```

`RUN_STATES` is `queued, starting, running, succeeded, failed, cancelled`; `TERMINAL_RUN_STATES` contains the last three. `RUN_PROTOCOL_VERSION` is `1`. `GENERIC_ERROR_CODES` is the error-code tuple in [errors.spec.md](errors.spec.md).

`RunContextPayload` carries optional `prompt: string` and `history: readonly JsonValue[]`. Encoding produces `jini-run-context:v1:` followed by JSON. Decoding returns only these two fields; it returns `undefined` for another prefix, malformed JSON, non-object payload, mistyped prompt, or non-array history. Entries inside history are not structurally validated.

## Registry validators

Every schema exposes Zod's `parse(value): T` and `safeParse(value): {success:true;data:T} | {success:false;error:ZodError}`. These are third-party positional methods, rather than object-argument package helpers. Each schema's inferred type is exported under the same name without `Schema`.

| Schema | Required shape and constraints |
|---|---|
| `RegistryBackendKindSchema` | `github \| http \| local \| db` |
| `RegistryTrustSchema` | `official \| trusted \| restricted` |
| `RegistryDistSchema` | Optional type (`github-release, https-archive, local-archive, database`), archive, integrity, manifestDigest; supplied strings non-empty |
| `RegistryPublisherSchema` | Optional id/name/github/url (non-empty), verified boolean |
| `RegistryMetricsSchema` | Optional downloads/installs/stars: nonnegative integers; updatedAt/lastPublishedAt: strings |
| `RegistrySignatureSchema` | kind (`github-oidc, cosign, minisign, custom`), non-empty signature; optional non-empty issuer/subject/certificate and signedAt string |
| `RegistryVersionSchema` | Non-empty version; optional source/ref/dist/integrity/manifestDigest, deprecated boolean or string, yanked boolean, yankedAt/yankReason strings |
| `RegistryEntrySchema` | name matching `^[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*$`; non-empty version/source; optional ref/title/description/tags/capabilitiesSummary/dist/versions/distTags/integrity/manifestDigest/publisher/homepage/license/deprecated/yanked/yankedAt/yankReason/metrics/signatures |
| `RegistryManifestSchema` | Non-empty specVersion/name/version; entries array |
| `RegistryListFilterSchema` | Optional object: query/tags/publisher/includeYanked |
| `RegistrySearchQuerySchema` | query defaults to `''`; optional tags, includeYanked, integer limit 1–500 |
| `RegistrySearchResultSchema` | entry, nonnegative score, matched string array |
| `ResolvedRegistryEntrySchema` | Non-empty backendId/source; backendKind/trust/entry/version; verified defaults false; optional verifiedIssuer/verifiedSubject/ref/integrity/manifestDigest |
| `RegistryPublishRequestSchema` | entry; optional packagePath/dryRun/tag/changelog |
| `RegistryPublishOutcomeSchema` | ok boolean; optional dryRun/pullRequestUrl; changedFiles/warnings default to `[]` |
| `RegistryDoctorIssueSchema` | severity (`error, warning, info`), non-empty code/message; optional pluginName |
| `RegistryDoctorReportSchema` | ok, non-empty backendId, numeric checkedAt, nonnegative integer entriesChecked, issues array |
| `RegistryYankOutcomeSchema` | ok, non-empty name/version/reason; optional dryRun/pullRequestUrl; warnings defaults to `[]` |

Dist, publisher, metrics, signature, version, entry and manifest preserve unknown keys with `.passthrough()`. Other object schemas strip unknown keys. Strings named URL, timestamp, version, digest, or source are not automatically validated as those formats. `verifiedIssuer` and `verifiedSubject` are optional independently of `verified`.

## Host-supplied ports

The package defines these interfaces; consumers supply implementations. Optional methods must be checked before use. An interface's optional argument does not itself install runtime defaults.

```ts
interface RegistryBackend {
  readonly id: string; readonly kind: RegistryBackendKind; readonly trust: RegistryTrust;
  list(required: {}, optional?: NonNullable<RegistryListFilter>): Promise<RegistryEntry[]>;
  search(required: { query: string }, optional?: Omit<RegistrySearchQuery, 'query'>): Promise<RegistrySearchResult[]>;
  resolve(required: { name: string }, optional?: { range?: string }): Promise<ResolvedRegistryEntry | null>;
  manifest(required: { name: string; version: string }): Promise<RegistryEntry | null>;
  doctor(required: {}): Promise<RegistryDoctorReport>;
  publish?(required: { entry: RegistryEntry }, optional?: Omit<RegistryPublishRequest, 'entry'>): Promise<RegistryPublishOutcome>;
  yank?(required: { name: string; version: string; reason: string }): Promise<RegistryYankOutcome>;
}
interface RegistryBackendFactory<TConfig = unknown> {
  readonly kind: RegistryBackendKind;
  create(required: { config: TConfig }): RegistryBackend;
}
interface EventLog {
  append<Payload>(required: EventLogAppendInput<Payload>, optional?: EventLogAppendOptions): Promise<EventLogEntry<Payload>>;
  replay(required: { runId: string; afterCursor: string | null }): Promise<EventLogReplayResult>;
  listRunIds(required: {}): Promise<readonly string[]>;
  drop(required: { runId: string }): Promise<void>;
}
```

`EventLogAppendInput` is `{runId,event,data}`; options carry `dedupeKey?`. Entries are readonly `{id,event,data,recordedAt}`. Replay returns `ok` with readonly entries and optional `truncated:true`, `unknown-run`, `invalid-cursor` with requestedCursor, or `replay-gap` with requestedCursor/oldestAvailableCursor. See [state.spec.md](state.spec.md).

## Wire-type inventory

| Exports | Consumer contract |
|---|---|
| JSON values | Import `JsonPrimitive`/`JsonValue` from `@jini-ai/core/primitives`; protocol owns the recursive Zod schema, not these type exports |
| `BoundedJsonConstraints` | maxDepth/maxObjectKeys/maxArrayLength/maxStringLength/maxSerializedBytes numeric policy; declarations only |
| `OkResponse`, `IdResponse`, `EntityResponse`, `EntityListResponse`, `Nullable` | `{ok:true}`, `{id:string}`, keyed entity/list records, `T \| null` |
| `RunState`, `RunStatus`, `RunCancelRequest` | State tuple member; status has id/state and optional label/detail/startedAt/updatedAt/endedAt; cancellation is runId/reason? |
| `RunEvent`, `RunEventName`, `RunEventPayload`, `RunProtocolEvent` | Envelope `{runId,eventId,opaqueCursor,protocolVersion:1,ts,kind,payload,durability}`; kind is start/agent/stdout/stderr/error/end; utility types select kind and payload |
| `RunStartPayload`, `RunChunkPayload`, `RunEndPayload` | `{runId,contextRef,agentId?,idempotencyKey?}`, `{chunk}`, `{code:number\|null,signal?,status?,resumable?,sessionRef?}`; end status uses `canceled`, whereas RunState uses `cancelled` |
| `RunAgentPayload` | Tagged variants: status, text_delta, thinking_start, thinking_delta, tool_use, tool_input_delta, tool_result, usage, raw, stage_start, stage_end, surface_request, surface_response, a2ui, mcp-ui, slow_running |
| `JournalProvenance`, `JournalEntry` | host/stdin or agent/stdout/stderr; entry has content/provenance/trust (`trusted \| untrusted`) |
| `CredentialStatus`, `ModelProvider`, `ModelCatalogOption` | configured/available/unconfigured; provider id/label plus optional hint/credentialsRequired/docsUrl; model id/label/providerId plus hint/default/caps? |
| `AgentDefinition` | id/name/available, optional version/models/reasoningOptions/diagnostics/installUrl/docsUrl/supportsCustomModel |
| `AgentFixIntent` | openDocs/openInstall/rescan/setEnv(envKey)/clearEnv(envKey)/launchOAuth(agentId) |
| `AgentDiagnosticReason`, `AgentDiagnosticSeverity`, `AgentDiagnostic` | Reason: not-on-path/not-executable/shim-broken/configured-bin-invalid/auth-missing/auth-unknown; severity error/warning/info; reason/severity/message and optional detail/searchedDirs/fixActions |
| Error types | `GenericErrorCode`, `ApiErrorCode`, `ApiError`, `ApiErrorResponse`, `ApiValidationIssue`, `ApiValidationErrorDetails`, `LegacyErrorResponse`, `CompatibleErrorResponse`, `RunErrorPayload`; [errors.spec.md](errors.spec.md) |

Event payloads with `unknown` fields (tool input, media, surface payload/value, a2ui message, mcp-ui resource) require host-side structural validation. The package implements no renderer or delivery transport.

## Minimal wiring

```ts
import { encodeRunContextRef, decodeRunContextRef, RegistryEntrySchema,
  createApiError, createApiErrorResponse, type EventLog } from '@jini-ai/protocol';

const contextRef = encodeRunContextRef({ payload: { prompt: 'Inspect the workspace' } });
const context = decodeRunContextRef({ contextRef });
const entry = RegistryEntrySchema.parse({ name: 'vendor/tool', version: '1.0.0', source: 'local:tool' });
const failure = createApiErrorResponse({ error: createApiError(
  { code: 'BAD_REQUEST', message: 'Invalid input' }, { retryable: false }) });
async function record(log: EventLog) { // log is provided by a storage adapter
  return log.append({ runId: 'run-1', event: 'start', data: { contextRef } }, { dedupeKey: 'start-1' });
}
```

## Evidence

Source: `src/index.ts` and each re-exported source module. Static test evidence: `src/__tests__/index.test.ts`, `registry.test.ts`, `run-context.test.ts`, `event-log-contract.test.ts`. Tests were read, not executed. This contract covers the source surface rather than verified distribution artifacts.

## Supplementary public contracts

These names are also reachable through the current export map. Parameter declarations below preserve source defaults, destructuring and collaborator types; linked declarations define result and DTO details. They do not add runtime validation beyond the behavior and error contracts. Types erase at runtime.

| Additional exported names | Kind and source |
|---|---|
| `RegistryDist`, `RegistryDoctorIssue`, `RegistryManifest`, `RegistryMetrics`, `RegistryPublisher`, `RegistrySignature`, `RegistryVersion` | type; [registry.ts](../../src/registry.ts) |

## Current manifest boundary

The current `package.json` exposes `.`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
