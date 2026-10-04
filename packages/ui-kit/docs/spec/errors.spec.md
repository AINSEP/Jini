Spec ID: SPEC-JINI-UI-KIT-ERRORS
Version: 1.0.0
Last Edited: 2026-10-03
Hash: sha256:5bd54392775eefa59554cb54e724b629ab7e60bcbc33c44b4317d4de01786fd9
spec_mode: implementation_spec

# UI-kit errors and refusals

## Configuration errors

`KitConfigError` extends Error, sets name `KitConfigError`, code `KIT_CONFIG`, and retains readonly string issues. Its message begins `Invalid UI kit:` and joins issues with semicolons.

| Trigger | Outcome |
|---|---|
| Incompatible contract or unsupported range syntax | KitConfigError from assertKitContract/needs/factories/provider requirement validation |
| Planned or unknown required component | KitConfigError from needs or provider requirement validation |
| Override value is neither a function nor a recognized React exotic component | KitConfigError from createKit |
| Strict kit misses an implemented component | Compile-time error for typed callers; KitConfigError at runtime |
| useToast without a provider service | KitConfigError |
| ToastRegion without a supplied or provider service | KitConfigError |
| push after toast disposal | Error with message `Toast service is disposed` |
| Default React conformance driver without DOM | Error with message `React conformance requires a DOM environment` |
| includeBrowser with default React driver | Error with message `Browser cases require a real browser driver` |

Factory validation checks component shape at a coarse level; it does not prove mounted behavior. This is why conformance scenarios and the development confirmation guard exist.

## Action refusals and callback failures

A blocked confirmation or dismissal returns false and invokes no action callback. Pending, executing, and closed states fail closed. Agent confirmation additionally requires agentMayConfirm permission. These are policy refusals, not thrown errors.

The pure controller propagates an onConfirm rejection while releasing its executing latch in finally. The React facade catches that rejection, renders errorLabel or `The action failed. Please try again.`, and releases React pending state while mounted. The host owns remediation and retries. The pure dismissal path invokes the onCancel port directly; a thrown callback error propagates.

## Guard diagnostics

Mounted confirmation violations append a component/reasons record to the kit and log a conformance error. Default guard fallback replaces the confirmation frame and actions with native implementations. Warn retains the faulty view while recording diagnostics. Off suppresses guard inspection and replacement. Development version skew emits console.warn; it does not silently create a separate provider context.

No guard mode changes server-side authorization or action-port permissions. Runtime diagnostics do not represent a production security boundary.

## Handoff

Inputs: needs.ts, toast.ts, pure confirmation controller, React confirmation hooks/guard/context. Output: actual throw/refusal/diagnostic surface. Risk: host port exceptions outside the facade remain host responsibilities. Next assignee: consumer integration owner.
