Spec ID: SPEC-JINI-AGENTIC-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:23529edb55ba2cf4badcb1c8b535949160816cc265ed397f5b93e1271e286532
spec_mode: reverse_spec


# Agentic error contract

## Exceptions and ordinary absence

| Error / result | Trigger | Caller action |
| --- | --- | --- |
| `WebMcpConfirmationRequiredError({ capabilityId, reason }, {} = {})` | Required confirmation missing (`no-handler`) or result not `true` (`declined`) | Supply user-interaction wiring or stop the declined action; no automatic retry |
| `InvalidWebMcpToolNameError({ capabilityId }, {} = {})` | Invalid tool name at projection | Fix the capability id before registering |
| `SkillInputError({ message }, { cause? } = {})` | Invalid base64, upload/path/metadata/size, archive content, GitHub URL/response or install precondition | Correct input; inspect optional cause; do not depend on an error-code enum |
| Ordinary `Error` | Unknown page capability, bad tool input, malformed handle, unfillable/refused field, unpublished page, invalid pointer parse, invalid layout/workspace, duplicate live tool id | Repair input/configuration or respect the field refusal; these messages have no stable structured package code |
| Zod `ZodError` | Calling schema `.parse` or a validating message builder with invalid data | Inspect issues or use `.safeParse`/public parser results |
| Driver/host-port exceptions | Page driver, filesystem, loader, parser, network, registry, clock/id factory or callback fails | Handle the dependency error; mutations may already be committed |
| Host inactive error | Calling a live tool whose current slot is inactive | Refresh/reselect tools; the consumer defines the error class/code |
| Subscriber exception | A synchronous interpreter listener throws | Repair/isolate listener; do not assume rollback |

The two WebMCP classes expose capability identity and confirmation reason where applicable, but no numeric/string code enum. `SkillInputError` does not assign a distinct `name` or `code`. Archive parsing wraps non-input failures with an input error; other filesystem/loader failures can propagate unchanged. Post-mutation `onChanged` errors require state reconciliation before retry.

Capability lookup returns `undefined`, input checking returns a message or `null`, field guards return refusal or `null`, and unsupported GenUI events return `null`. These are expected value results.

## A2UI parser and resolver results

| Result code / reason | Meaning / caller action |
| --- | --- |
| `MISSING_VERSION`, `UNSUPPORTED_VERSION` | Require the supported version before applying a message |
| `NO_MESSAGE_KEY`, `AMBIGUOUS_MESSAGE` | Supply exactly one recognized payload key |
| `VALIDATION_FAILED` | Fix envelope/catalog/component validation; agent parser may include a path |
| `PATH_NOT_FOUND` | Binding does not resolve; supply model data or change the pointer |
| `FUNCTION_NOT_REGISTERED` | Catalog does not allow the function |
| `FUNCTION_NOT_CALLABLE_FROM_SIDE` | Respect renderer/agent invocation boundary |
| `FUNCTION_NOT_IMPLEMENTED` | Provide the catalog implementation |
| `FUNCTION_THREW` | Inspect resolver detail and repair the implementation |
| `INDEX_OUTSIDE_LIST_CONTEXT` | Supply item scope for `@Index` |
| `RELATIVE_PATH_OUTSIDE_LIST_CONTEXT` | Supply list item base path or use an absolute binding |

Agent-message parsing uses `{ ok: false, code, message, path? }`; renderer parsing uses `{ ok: false, reason }`. Resolver failures use `{ ok: false, reason, detail }`. Build-action failures similarly return a reason instead of executing an action. Interpreter errors are renderer messages when attribution is available, otherwise `unattributedViolation`; component application can be partial.

Function-call interpreter errors use `INVALID_FUNCTION_CALL` for missing/disallowed functions and more specific resolution reasons otherwise. Call errors are returned even if no successful response was requested. Unknown surfaces and duplicate surface creation become `VALIDATION_FAILED` messages.

## JSON-RPC error vocabulary

`JSON_RPC_ERROR_CODES` supplies parse error −32700, invalid request −32600, method not found −32601, invalid params −32602, internal error −32603. `createJsonRpcError` builds these or caller-supplied codes; this package does not route requests or throw an exception for every wire code. Transport callers decide correlation, logging and retry behavior.
