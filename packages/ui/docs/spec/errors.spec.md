Spec ID: SPEC-JINI-UI-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:e5873d1eff8a0c716a7ce6b942999d6bc423922b695f1d4e6f375fd3dbdaf91b
spec_mode: reverse_spec


# Error contract: @jini-ai/ui

## Error model

This package declares no shared error superclass or universal exception-code envelope. Public APIs mix native Error/TypeError/DOMException, named error wrappers, rejected host promises, boolean/null outcomes and protocol results. Do not infer an HTTP status from a UI error. Error callbacks and dictionaries are caller copy.

## Exceptions and caller actions

| Error / message | Trigger | Caller response |
|---|---|---|
| `Error: Fetch-query hooks require FetchQueryProvider` | Any query/mutation/loader/invalidate hook outside its provider | Mount the provider around every hook consumer; this is wiring failure, not a retryable request. |
| Query `Error` channel | Injected fetch/run rejects; non-Error values normalize to their nonempty string or `request failed` | Render/retry based on host error policy. Awaited loader/mutation promises still reject with the original value; catch those separately. Earlier query data can coexist with error. |
| `Error: <JSON key> data is undefined` | Current cache read resolves undefined | Return a defined domain result or reject the underlying failure; render the error and correct the fetch contract. |
| `TypeError` with semicolon-joined theme validation messages | `applyAdminTheme` receives invalid theme | Inspect `validateAdminTheme({theme})`, fix input, then apply again; validation happens before DOM effects. |
| `TypeError: System color scheme requires matchMedia` | Missing media port for system, or invalid preference supplied at runtime | Supply the port or a valid explicit scheme. |
| `Error` requiring `crypto.getRandomValues` | Default confirmation token source unavailable when mint is called | Supply a secure randomToken adapter or fix host crypto; do not use weak randomness. Construction itself does not probe crypto. |
| Confirmation builder `Error` | Duplicate/reserved alternative ids, duplicate choice ids, or choicesParam collision with confirm/alternative params | Correct the builder spec; do not retry the unchanged input. |
| Field-name `Error` | `fieldElementId` or a field renderer receives a name outside `[A-Za-z_][A-Za-z0-9_.-]*` | Choose a valid unique field name. |
| `Error: This host executes no tools.` | MCP View requests tools/call without onToolCall | Provide an authorized executor or keep the host read-only and display the protocol refusal. |
| Executor rejection | Host's MCP tool callback rejects | Underlying AppRenderer relays a JSON-RPC failure; preserve diagnostics and retry only according to tool policy. UI state alone does not roll back a side effect. |
| `DOMException` named `AbortError`, message `retry cancelled` | Default retry wait sees abort | Treat cancellation as non-failure; host must cancel its own network request separately. |
| Named `FileSystemReadError` | `createFileSystemReadError(action,error)` wraps a read failure | `isFileSystemReadError` checks Error instance/name; display `FILE_SYSTEM_READ_ERROR_MESSAGE`, retain cause for diagnostics and allow user retry. No distinct exported class/code exists. |
| `Error: Rename failed` | Asset-tree rename port gives no renamed file | Keep the edit/error UI visible; inspect host rename result before retry. |
| Diagnostics export `Error` | Diagnostics export response not ok | Surface error; fix host endpoint/transport before retry. |
| `Unknown MCP client id: ...` | MCP snippet selection receives unsupported runtime client id | Validate client selection against exported catalog. |
| Memory adapter `Error` | Non-ok list/tree/entry/extraction response, or successful envelope missing required field | Render load/action error; correct host response contract. A genuine missing entry may resolve null instead. |
| Host/DOM/library exception | Injected ports/callbacks throw, JSON serialization fails, DOM/font application fails, or editor peer fails | Preserve the original exception; no stable package code is attached. Theme application restores captured state on effect failure. |

Source: `src/features/panel-kit/fetch-query/{cache.ts,adapter.react.tsx}`, retry helper, `src/theme/{apply.ts,validation.ts,color-scheme.ts}`, MCP builders/host, filesystem errors, asset-tree rename, diagnostics button, integrations rules and memory dependencies.

## Result discriminators and protocol codes

| Result/code | Meaning | Caller response |
|---|---|---|
| `{ok:false, reason:'unknown-or-expired'}` | Unknown/expired/replayed confirmation token | Request a fresh human confirmation; execute no pending action. |
| `{ok:false, reason:'binding-mismatch'}` | Minted identity claim differs; token was burned | Reconstruct intended binding and request fresh confirmation; never execute on mismatch. |
| `SURFACE_NOT_PENDING` in JSON-RPC `error.data.code` | Caller tool reports that the pending action is expired/consumed/unavailable | Generated surfaces show expiry and remain disabled. This package exports the code but does not throw a matching error class. |
| JSON-RPC `-32601` | Generated View receives a method it does not implement | Use a supported method; it is returned by the bridge script, not thrown by the host API. |
| `{isError:true}` for ui/open-link | MCP host has no open-link callback | Supply explicit link policy/handler if links are supported. |
| MCP host `timed-out` / `errored` | No first size report before deadline / client error before readiness | Show recovery UI; create a fresh session or correct proxy/client integration. No synchronous timeout exception is thrown. |
| Parser/read helper `undefined`, registry `null` | Unsupported/malformed resource metadata or no match | Use a fallback renderer or reject the input; absence is not an exception. |
| `{valid:false,errors}` | Invalid serializable AdminTheme | Present individual validation messages before application. |
| A2UI apply rendererMessages / unattributedViolation | Dependency interpreter reports a wire/catalog validation failure | Send returned messages through host transport; log unattributed local diagnostics without fabricating a surface id. |
| A2UI `{ok:false,reason}` | Interpreter cannot resolve/build the requested action/value | Keep failure visible; correct data/catalog/action. Underlying dependency owns reason vocabulary. |
| Port-specific null/false or `{ok:false,message}` | A documented not-found, cancellation or reached-but-declined domain outcome | Follow that port's result contract; do not relabel it as empty success or suppress transport rejection. |

## Render-time recovery

`KitErrorBoundary` is a component around a React error boundary, not an error class. It catches descendant render/lifecycle errors and renders its fallback/reporting behavior. It does not catch event handler errors, rejected async promises or failures outside the subtree. Consumer handlers must catch those paths explicitly.

`useAsyncAction.run` swallows action failure after storing caller-described text, except errors thrown by the formatter itself; AbortError is silent. Serial writes propagate each task's rejection without poisoning the next lane task. Neither mechanism supplies automatic rollback.

## A2UI clock contract

The A2UI barrels no longer re-export the obsolete `A2uiClockPort` type. The interpreter accepts `Clock` from `@jini-ai/core/primitives` and uses `clock.nowMs()`; hosts must supply that shared contract.

## Browser transport failures

Browser deadline/cancellation uses native AbortSignal/fetch errors, including native timeout reasons. It does not wrap them as platform FetchTimeoutError. Supplied fetch/manifest errors flow into the owning component/port's existing error boundary; no universal retry is added.

## A2UI clock type imports

Import the shared `Clock` directly from `@jini-ai/core/primitives`; no UI-specific clock alias is provided. The dependency's clock contract flows directly through [protocol.ts](../../src/features/a2ui/protocol.ts) and [index.ts](../../src/features/a2ui/index.ts) via the re-exported interpreter factory.
