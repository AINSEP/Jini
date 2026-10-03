# Jini specification refresh report

Refreshed all five requested contracts in each of **34 packages (170 spec files)**, including nested `cms/forms`. Added the missing analytics specifications and missing UI/state contracts. Removed draft-status lines, preserved decision links, and added version 2.0.0 reverse-spec metadata with SHA-256 fingerprints. Spec versions identify documentation revisions independently of package versions.

The earlier spec reports, architecture briefs and wave reports were used as leads; current manifests, barrels and source declarations govern these documents. Static source inspection preserves remaining positional APIs and specialized ports rather than claiming that every function has already been converted.

Edits are confined to package `docs/spec/` directories. No tests, builds, Node processes, installs or Git writes were performed. These are source-derived specifications, not runtime certification or an implementation handoff.

## Changes by package

Each linked API document sits beside the refreshed behavior, error, state and UI contracts.

| Package | Changes |
|---|---|
| [@jini-ai/admin](../../../admin/docs/spec/api.spec.md) | Refreshed shared primitive imports, object arguments and HTTP headers. Replaced fixed Sidebar/RowMenu/hook migration findings with current behavior; retained screen, transport and headless-route limits. |
| [@jini-ai/agent-plugins](../../../agent-plugins/docs/spec/api.spec.md) | Completed the UI/host contract and public typed-error inventory; retained current fetch, install, activation, lock and uninstall semantics. |
| [@jini-ai/agent-runtime](../../../agent-runtime/docs/spec/api.spec.md) | Refreshed provider/public helper declarations, core clock/record contracts, consolidated OAuth delegation and fail-closed DNS behavior. Preserved the actual local token-file writer and pending-cache timer behavior. |
| [@jini-ai/agentic](../../../agentic/docs/spec/api.spec.md) | Updated core Clock.nowMs wiring, DOM driver dependencies and GenUI timing options; expanded public types. Added the framework-free UI/host contract and removed fixed DOM driver migration findings. |
| [@jini-ai/analytics](../../../analytics/docs/spec/api.spec.md) | Created all five specs: public exports, privacy/drop policy, normalization, hashing, ingestion, query windows, in-memory retention and headless scope. Ownership is independent of platform. |
| [@jini-ai/artifacts](../../../artifacts/docs/spec/api.spec.md) | Completed public types and UI/host obligations; reconciled suppression and text decoding with current source while retaining streaming and file-scan limits. |
| [@jini-ai/capability-providers](../../../capability-providers/docs/spec/api.spec.md) | Expanded exported provider DTO/port inventory and added headless UI scope. Updated the host-clock example; preserved remaining positional database adapters and specialized timing ports as implemented. |
| [@jini-ai/chat](../../../chat/docs/spec/api.spec.md) | Refreshed object arguments and dedicated AG-UI, SSE, embed, storage, finalizer and page-action contracts. Added missing public React components/props and preserved the optional reference stylesheet boundary. |
| [@jini-ai/cli](../../../cli/docs/spec/api.spec.md) | Refreshed declared command/factory parameters and added headless UI scope; retained explicit caller-owned process, output and command dependencies. |
| [@jini-ai/cms](../../../cms/docs/spec/api.spec.md) | Moved trash and settings HTTP contracts to their actual subpaths; removed generic widgets, identity and registration-kit ownership. Updated primitive types, aliases, cache scope, service arguments and public error inventory. |
| [@jini-ai/cms-forms](../../../cms/forms/docs/spec/api.spec.md) | Reconciled notification subscription with the implemented object-shaped EventBusPort; removed the fixed integration-gap findings. Added UI scope and completed the public error inventory. |
| [@jini-ai/core](api.spec.md) | Documented primitives, JSON types, canonical HTTP DTOs, text/redaction and timing-safe comparison ports. Added agent-tool metadata and registration-kit declarations, gates and confirmation lifecycle. |
| [@jini-ai/daemon](../../../daemon/docs/spec/api.spec.md) | Refreshed lifecycle/executor/frontend/routine/store object APIs and moved domain HTTP/read-only-tool contracts here. Added scheduler, audit, exchange, coordination and credential entry contracts; removed fixed watchdog/journal findings. |
| [@jini-ai/db](../../../db/docs/spec/api.spec.md) | Added current message/catalog exports and shared registration-kit ownership; preserved transfer, confirmation, adapter and read-only-tool behavior. Added headless UI obligations. |
| [@jini-ai/desktop-host](../../../desktop-host/docs/spec/api.spec.md) | Refreshed injected update/timer/effect types and the native updater composition example; retained current desktop surface, lifecycle and error boundaries. |
| [@jini-ai/devops](../../../devops/docs/spec/api.spec.md) | Documented the Node reachability-port factory, injectable transport/DNS overrides and dispatcher lifecycle; added headless UI scope. |
| [@jini-ai/diagnostics](../../../diagnostics/docs/spec/api.spec.md) | Completed the headless UI contract and refreshed metadata; retained the verified shared-clock/secret-catalog integration and diagnostics-specific sanitization/results. |
| [@jini-ai/http-kit](../../../http-kit/docs/spec/api.spec.md) | Removed daemon-domain and CMS-settings contracts. Documented generic routing/request/response, origin re-exports, message options and actual specialized rate-limiter/origin clocks. |
| [@jini-ai/infra](../../../infra/docs/spec/api.spec.md) | Completed the headless UI contract and refreshed source/manifest boundaries for the two composition shims; retained their narrow re-export semantics. |
| [@jini-ai/integrations](../../../integrations/docs/spec/api.spec.md) | Expanded canonical credential/HTTP DTOs and public error/types. Removed fixed comment mismatches for recovery claims, audio units, dispatch staging, credential headers and provider options; added UI scope. |
| [@jini-ai/mcp](../../../mcp/docs/spec/api.spec.md) | Updated scope-based approval storage, caller-owned fingerprint domain, messages/error identifiers and shared primitives. Documented secure writing and sanitization; completed public types and UI scope. |
| [@jini-ai/memory](../../../memory/docs/spec/api.spec.md) | Completed public extraction/configuration port types and headless UI obligations; retained inspected extraction rejection, retention and repository ownership behavior. |
| [@jini-ai/oauth](../../../oauth/docs/spec/api.spec.md) | Completed pending-authorization, transport, discovery, registration and refresh type inventory and headless UI scope. Preserved current proactive reauthorization and due-versus-expired messages. |
| [@jini-ai/platform](../../../platform/docs/spec/api.spec.md) | Removed analytics and CMS-trash ownership; documented network classification, atomic writes, async/native filesystem ports and token/inode-owned file locks, including error inputs and durability limits. |
| [@jini-ai/plugins](../../../plugins/docs/spec/api.spec.md) | Created the missing state contract and headless UI contract; retained explicit capability-gate, registration and dispatch lifetimes without implicit host effects. |
| [@jini-ai/protocol](../../../protocol/docs/spec/api.spec.md) | Refreshed object declarations and shared base-type ownership in core; retained wire schemas and transport semantics. Added public compatibility-type inventory and headless UI scope. |
| [@jini-ai/registry](../../../registry/docs/spec/api.spec.md) | Rewrote API contracts for object-shaped operations and required injected HTTP. Added builder/search/lifecycle/SQLite interfaces and current core-clock/default behavior; added UI scope. |
| [@jini-ai/sandbox](../../../sandbox/docs/spec/api.spec.md) | Reconciled SDK creation failures with typed wrapping and retained failed-boot/teardown limits. Preserved worker budgets and current watcher echo handling; refreshed all five contracts. |
| [@jini-ai/server](../../../server/docs/spec/api.spec.md) | Removed obsolete bind-host/grant/awaiting-input migration findings; preserved the current four manifest entries, storage ownership, graceful shutdown and readiness behavior. Added public types and UI scope. |
| [@jini-ai/sidecar](../../../sidecar/docs/spec/api.spec.md) | Reconciled atomic writer/process adapter behavior and corrected malformed-IPC errors to actual SyntaxError messages. Added UI scope while preserving pointer-removal concurrency and supervisor limits. |
| [@jini-ai/sqlite](../../../sqlite/docs/spec/api.spec.md) | Replaced obsolete acquisition/server contracts with the current deprecated compatibility facade over db, chat, daemon and registry. Documented supported imports, remaining legacy forms and borrowed ownership; added UI scope. |
| [@jini-ai/ui](../../../ui/docs/spec/api.spec.md) | Updated styles ownership, core primitives, modern panel/query/A2UI contracts and current subpaths. Added source-linked declarations for exported helpers/components/types omitted from earlier specs; retained implemented legacy positional APIs. |
| [@jini-ai/user-management](../../../user-management/docs/spec/api.spec.md) | Updated shared clocks/IDs, configurable messages and moved identity-registration wiring. Replaced fixed guard/seed/schema migration findings with current transactions, validation and grant behavior; retained React contracts. |
| [@jini-ai/vibecoding](../../../vibecoding/docs/spec/api.spec.md) | Completed current public port/types and manifest scope while retaining edit/history/HTML/React behavior, including unvalidated retention and promise-handling limits. |

## Remaining source contract contradictions

These discrepancies remain in code; the refreshed specs explicitly describe the observed behavior. Findings are based on source inspection, without compilation or execution.

| Package | Contract versus implementation | Source evidence and consequence |
|---|---|---|
| UI / agentic | UI re-exports `A2uiClockPort`, which the current agentic A2UI entry no longer exports. Agentic now takes core `Clock`. | `packages/ui/src/features/a2ui/protocol.ts:10` and `packages/ui/src/features/a2ui/index.ts:5`; `packages/agentic/src/core/a2ui/interpreter.ts:1` and `:193`. This leaves an unresolved source type export. See [UI error contract](../../../ui/docs/spec/errors.spec.md). |
| daemon | `ToolAttemptAuditSink.append(required, optional?)` puts `detail` in the optional object, but the caller puts it in `required` and omits `optional`. | `packages/daemon/src/tool-audit.ts:25` versus `:38`. A conforming sink reading its optional object loses audit detail. See [daemon error contract](../../../daemon/docs/spec/errors.spec.md). |
| CMS settings | The reader comment promises a live-key operation that never throws; dependency calls and registered coercers have no exception boundary. | `packages/cms/src/settings/settings.ts:307`, `:323` and `:333`. Repository and coercion exceptions reject the read. The spec preserves propagation rather than promising total reads. See [CMS error contract](../../../cms/docs/spec/errors.spec.md). |

## Additional current risks

These are implemented limits or possible bugs, not unresolved ownership decisions.

- **Vibecoding:** a negative history limit can loop forever after a committed entry because shifting an empty array cannot make its length less than a negative limit. `packages/vibecoding/src/core/history.ts:166` and `:173`. The [behavior contract](../../../vibecoding/docs/spec/behavior.spec.md) records the required caller-side valid range.
- **Sandbox:** successful SDK creation followed by root-directory or watcher setup failure does not automatically kill the created sandbox. `packages/sandbox/src/e2b/provider.ts:107` and `packages/sandbox/src/e2b/wrap-e2b-sandbox.ts:157`, `:171`. The [state contract](../../../sandbox/docs/spec/state.spec.md) records failed-boot cleanup ownership.

Earlier reports' watchdog cancellation, journal rejection-comment, admin shell argument, forms subscription, source grant/bind-host and malformed-IPC findings were checked against current code and removed or rewritten where fixed. Remaining process-local locks, cache scope, non-atomic cross-port mutations and partial cleanup are documented in their owning package contracts.

## Static verification

- Enumerated current package manifests, including the nested forms package; each has all five requested spec files.
- Reconciled manifest entry points and public barrel inventories with API documents, including missing source-linked parameter/type contracts.
- Checked 2,220 local Markdown links and code-fence balance across all 171 Markdown files in spec directories; no failures.
- Checked absence of draft-status lines and forbidden owner references.
- Recomputed and verified all 170 canonical-content hashes. Canonicalization strips the metadata header, collapses whitespace, then hashes UTF-8 content with SHA-256.
- Existing `docs/decisions/` links remain; decision documents and process documentation were not edited.

No runtime or compiler result is claimed. This report is an additional review artifact within the permitted spec directory.
