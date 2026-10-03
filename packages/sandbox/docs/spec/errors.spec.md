Spec ID: SPEC-JINI-SANDBOX-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:1319a840477a330a2e9cd6518e6f3f1714b7805da697b9472c1048133f54cb33
spec_mode: reverse_spec


# Error Contract: sandbox

## Core and E2B

`SandboxOperationError` extends `Error`, sets `name = 'SandboxOperationError'`, and carries readonly `category: SandboxErrorCategory` plus optional standard `cause`. Constructor: `new SandboxOperationError({category, message}, optional?: ErrorOptions)`. There is no numeric status or separate `code` property.

| Category | Actual E2B mapping / condition | Caller action |
|---|---|---|
| `permission-denied` | Error named `AuthenticationError` | Fix credential/access policy |
| `not-found` | `FileNotFoundError`, `NotFoundError`, `SandboxNotFoundError` | Reconcile file/session existence |
| `timeout` | `TimeoutError`; any preview fetch rejection, including network failure | Retry preview under a host-owned budget; diagnose persistent failure |
| `unavailable` | `RateLimitError`, `NotEnoughSpaceError` | Back off or reclaim quota/storage |
| `port-in-use` | Core category available for other adapters; E2B name mapper never produces it | Select another port if a provider returns it |
| `unknown` | Other error names, non-Error thrown values | Log cause; avoid blind side-effect retries |

Wrapper messages identify the failed operation: project-root creation, watch startup, mount/read/list, command/install/start/kill, preview, watch stop or sandbox termination. Caught backend errors become `cause`. Teardown attempts all process kills, ignores their failures, and prioritizes sandbox termination over watcher-stop failure.

`createE2bSandboxProvider().boot()` wraps native and injected SDK-create failures in `SandboxOperationError`, categorizing the original error and retaining it as `cause`. Known boundary exceptions: `getHost()` executes before preview's fetch catch, and conversion/callback exceptions are not universally wrapped. A consumer cannot safely assume every failure is `SandboxOperationError`; handle unknown failures too. Missing optional SDK peer can fail the `./e2b` import before any factory call.

## Node worker

Worker APIs do not use `SandboxOperationError` or category codes.

| Error | Condition | Caller action |
|---|---|---|
| `RangeError('timeoutMs must be a positive integer within the Node timer range')` | Invalid timeout; rejected promise before spawn | Correct budget |
| Native/injected error | Worker creation, cloning, resource failure, event subscription, scheduler or decoder throws | Fix input/port/runtime; spawned workers receive cleanup attempts |
| `Error('<label> worker exited with code <code>')` | Exit before result, including code zero | Inspect worker's result protocol |
| `Error('<label> exceeded <ms>ms timeout')` | Invocation deadline | Reduce work or increase explicit budget |
| `Error('invalid worker render reply')` | Nonobject or wrong `ok/html/error` shape | Fix worker codec |
| `Error(reply.error)` | `{ok:false,error:string}` render reply | Present/report the renderer failure |
| `TypeError('TypeScript bootstrap requires an absolute filesystem entry path')` | Bootstrap with URL or relative string | Supply absolute string path or omit bootstrap |

Render convenience appends ` render` to the supplied label before invoking the harness. Worker termination exceptions/rejections are swallowed to preserve the first result. No automatic retry occurs.

Sources: [error class](../../src/core/errors.ts), [mapper](../../src/e2b/categorize-e2b-error.ts), [wrapper](../../src/e2b/wrap-e2b-sandbox.ts), [worker](../../src/node-worker.ts).
