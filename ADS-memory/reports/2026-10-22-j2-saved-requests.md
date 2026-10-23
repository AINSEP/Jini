# J2 saved-request interpreter handoff

Programmer(Execution), with Security review constraints: implementation and hostile-input
boundary work; both canonical persona files were loaded before code changes.

Inputs: the 2026-10-22 visitor-tools design/review (J2/T4 and security), Jini's locked
extraction plan, existing credentialed HTTP and platform guarded HTTP contracts.

## Result and API

Additive Node subpath `@jini-ai/integrations/saved-requests`:

- `parseSavedRequestDefinition({ value }, options = {})`: detach and validate stored data.
- `executeSavedRequest({ deps, workspaceId, definition, input }, { signal? } = {})`:
  resolve one host-owned opaque credential ID and current revision, execute once, redact,
  positively select typed fields and return `{ trust: "untrusted", items }`.
- `SavedRequestError` / value-free error codes and definition/result/port types.

The definition fixes HTTPS origin, path and method. Only declared query/JSON-body value
bindings vary. No path/host/header/auth templates, executable code, arbitrary model-facing
HTTP tool or plugin loading. The review's fixed-path J2 row supersedes the dispatch's
broader path-template wording. Fixed filters cannot be overridden by visitor bindings.

The existing guarded client provides HTTPS, private/mixed DNS denial, pinned peers,
zero redirects, 65,536-byte encoded/decompressed response caps, socket timeout and a
10-second total deadline. Input, request and projected output each have 16 KiB bounds;
definitions also have a 16 KiB bound. Invalid/oversized/truncated/non-JSON responses refuse.
The existing credentialed HTTP owner supplies authentication, redaction and transport
audit. Its additive `responseFormat: "json"` option decodes JSON strings before redaction
to close escaped-token echoes; callers omitting it retain their original text behavior.

See `packages/integrations/src/saved-requests/README.md` for a complete definition,
schema subset, credential revision contract and composition instructions.

## Files and reuse decisions

- `packages/integrations/src/saved-requests/{types,validation,schema,definition,projection,execute,index}.ts`:
  generic declarative contract, closed validation, schema compiler, bindings and projection.
- `packages/integrations/src/saved-requests/README.md`: API and host responsibility contract.
- `packages/integrations/src/saved-requests/__tests__/{definition,execute,projection,schema}.test.ts`
  and `fixtures.ts`: behavioral/refusal cases using injected DNS, HTTP, credential, audit
  and clock fakes. No real providers, timers, keys or services.
- `packages/integrations/src/credentialed-http/{credentialed-request,response-redaction}.ts`
  and their existing unit-test files: opt-in decoded JSON secret redaction in its owner.
- `packages/integrations/{package.json,README.md}`: additive export/runtime/type mappings,
  documentation and the already-used schema validator as an optional peer/dev dependency.
- `CAPABILITIES.md`: index the new behavior owner for future reuse-before-write discovery.
- `pnpm-lock.yaml`: only the integrations importer for existing locked schema version 4.1.1;
  edited without installing or regenerating dependency resolutions.
- `.changeset/integrations-saved-requests.md`: **minor** integrations release.

Reuse: authentication/origin binding/redaction/audit; inspected credentialed-http's request,
scheme and redaction owners; calls `makeCredentialedRequest` with a resolver restricted to
the single resolved base-origin credential. JSON redaction extends that same owner.

Reuse: SSRF/deadline/redirect/byte controls; inspected platform guarded client/transport
and the host's SINGLE_HOP_HTTPS_EGRESS_POLICY; constructs the existing guarded client with
the equivalent narrowed policy. No duplicate address classifier, redirect loop or timer.

Reuse: schema/value bindings; inspected installed validator use in agent-plugins/MCP and
the workspace lockfile; uses @cfworker/json-schema, URLSearchParams and JSON serialization.
The new mechanism only constrains supported declarative syntax and positively projects
output, behavior not owned by those existing modules.

No original why-comments, tests, assertions or supported behavior were deleted. No
coverage exclusions or thresholds changed. No vendor/commerce code or plugin imports.

## Verification performed and remaining

Per dispatch, **no tests, install, build, commit, publish or service startup** occurred.
The checkout has no installed dependencies. A scoped `tsc --noEmit` check passed using
temporary `/tmp/jini-j2-tsconfig.json`, current checkout core primitive sources, and already
installed dependency declarations from Tovu (platform 0.5.10, schema validator) and the
main Jini checkout (Vitest). Scope: saved-request sources/tests and response-redaction
unit tests; its source imports also check both changed credentialed HTTP production files.
This is not a full workspace/package typecheck or release compatibility proof.

`git diff --check` passed. A read-only TypeScript AST complexity scan found maximum CCN
6 in the new interpreter functions; the new credentialed JSON helper is also below 10.
This was a static scan, not a lizard execution. Function inputs use the required object /
optional object convention. Existing positional redaction APIs retain compatibility.

51 test declarations added, including table-driven cases. Existing credentialed-request
unit declarations: 77 -> 79; response-redaction: 13 -> 15. New definition/execution/
projection/schema files contain 13/25/7/2 declarations. These are source counts, not
executed/expanded case counts. No tests removed or skipped.

**Coverage is unmeasured.** Tests target the required 100% statements/branches/functions/
lines for every touched production file, including existing credentialed HTTP behavior;
central execution must establish the result and report any gaps. No green claim is made.

Exact focused command for the coordinator, from the Jini checkout:

```sh
npm --prefix packages/integrations run test -- src/saved-requests/__tests__/definition.test.ts src/saved-requests/__tests__/execute.test.ts src/saved-requests/__tests__/projection.test.ts src/saved-requests/__tests__/schema.test.ts src/credentialed-http/__tests__/credentialed-request.unit.test.ts src/credentialed-http/__tests__/response-redaction.unit.test.ts
npm --prefix packages/integrations run test:coverage
npm --prefix packages/integrations run typecheck
```

The full coverage command retains the package's unchanged 100% thresholds and existing
tests; inspect JSON coverage for all touched files before delivery.

## Exact Tovu integration points for T4

All following paths are under `/Users/la/Programming/Tovu`; no Tovu files were edited.

1. `apps/website/src/features/settings/visitor-tools-service.ts`:
   extend `createVisitorToolsManagement`'s existing prepare/apply/CAS flow for saved
   definitions; call `parseSavedRequestDefinition` at save and read. Keep ID/title/effect/
   modes/limits as host policy. Save new definitions Off; creation/exposure changes require
   the reviewed fresh, non-remembered public-data approval; permanent delete uses its
   existing confirmation owner. Do not introduce an alternate settings writer.
2. `apps/website/src/features/settings/visitor-tools-{agent-tools,registrations,write}.ts`
   and `apps/website/src/contracts/site-assistant/visitor-tools.ts`:
   replace T4 save/delete refusal stubs, close their schemas, declare durable effects/risk,
   extend the bounded stored policy shape and retain `visitor-tools.manage`, CAS and
   dedicated-writer protection. Definitions contain references only, never tokens.
3. `apps/website/src/assistant/site/capability-registry.ts` and `visitor-executor.ts`:
   add eligible created definitions to the visitor-only catalog. After live policy,
   confirmation and quota checks, call `executeSavedRequest` with the mounted workspace,
   host-selected definition and executor's AbortSignal. The current capability contract
   drops the handler signal, so T4 must propagate it. Also replace its built-in-only
   `readOnly: true` descriptor assumption with each created operation's approved effect.
   Pass `result` only; never create a client directive from external output.
4. `apps/website/src/server/runtime/composition/deps.ts` and
   `modules/site-assistant.ts`: bind the new ports. Reuse `createNodeGuardedHttpPorts`,
   trusted clock/timeout signal, scheme registry and existing credential audit adapter;
   supply trusted public/admin/API/control origins. The interpreter constructs its own
   narrowed guarded client, so do not pass the general custom-credential HTTP client
   (which follows redirects). External npm adoption follows the coordinator's Jini release.
5. `apps/website/src/features/custom-credentials/{store,types,vault-repo}.ts` and
   `apps/website/src/platform/secrets/vault-kinds.ts`: add the host ID resolver adapter.
   Start with `repo.findById({ workspaceId, id })`; use the existing vault service / scoped
   `createTovuStoreVault(...).get(...)` to obtain payload and authoritative metadata/revision
   from one read. Return `String(resolved.summary.revision)` with baseUrl/connection and
   verify the current visitor-use grant. The existing `resolveCustomCredentialByLabel`
   returns no revision and cannot satisfy this port; never resolve a mutable label for
   visitor execution or combine a pre-read revision with a later secret read.
6. `apps/admin/src/features/ai-assistant/VisitorToolsPanel.tsx` and its
   `hooks/use-visitor-tools.hooks.ts`: connect the create drawer to the same management
   service and existing secure credential picker. Review discloses exact endpoint,
   credential account, public fields, effect, mode and limits. JSON projection URL fields
   carry allowed origins; both widget renderers must enforce the reviewed link rule.

Remaining host work: T4 integration and released-package contract check, central tests/
coverage, security review of the release boundary and normal coordinator release/commit.
This interpreter does not own policy, visitor consent, grants, settings, quotas or audit
retention. A denied/failing external mutation is never automatically retried.

Discovery limitation: MCP/Graphify artifacts are absent here; the available older
understand-anything graph has no relevant entries, so source reads were used. Required
sidekick spawn failed with the orchestration thread-store error before creating an agent;
no helper/process remains. Pre-existing untracked `AI-Dev-Shop/AI-Dev-Shop` was untouched.
