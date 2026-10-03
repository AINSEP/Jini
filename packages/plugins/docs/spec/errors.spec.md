Spec ID: SPEC-JINI-PLUGINS-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:66965e3a952920297d98a4b2ab9890865efc6362df3fe9a77b0c0fad94fcf93c
spec_mode: reverse_spec


# Error Contract: Plugin Glue

## Thrown errors

`GlueCapabilityDeniedError({ moduleId, capability }, optional = {})` extends `Error`, sets `name = 'GlueCapabilityDeniedError'`, and exposes `moduleId` and `capability`. It has no `code` field. A denied slot includes a declared capability whose delegate is absent or not an own function. The caller must supply the grant and delegate before retrying; do not bypass the gate.

Content/event host errors and synchronous dispatcher errors propagate unchanged. Handle them at the consumer boundary. Asynchronous dispatcher rejection belongs to the promise inside `result`.

## Returned diagnostics

| Code or reason | Condition | Caller response |
|---|---|---|
| `MANIFEST_MALFORMED` | Invalid root, unknown/missing key, invalid id, wrong version/range/array type, non-object attachment | Correct manifest shape; do not mount it while errors remain |
| `CAPABILITY_UNKNOWN` | Capability outside the supplied vocabulary, including non-string values | Correct declaration or deliberately extend host vocabulary |
| `CALL_SITE_UNKNOWN` | Attachment call site missing or outside the supplied vocabulary | Correct attachment or host vocabulary |
| `UNWIRED_CALL_SITE` | Dispatch call site absent from `wiredCallSites` | Wire its delegate before dispatch; no delegate was invoked |
| `THROW` | Module build or host registration throws | Inspect quarantine `detail`; repair builder or atomic host registration |
| `DUPLICATE_TOOL_ID` | Collision with core, earlier successful module, or the same batch | Assign unique ids and retry the corrected batch |

Validation errors always have `file: null`. Quarantine results retain the module id and a string detail, not the original exception. No HTTP status mapping or logging is provided.

Evidence: `src/glue/manifest.ts`, `capability-gate.ts`, `dispatch.ts`, and `attachment-points/tool-registration.ts`. No code/comment contradiction was established for this entry point from the inspected current source and assertions.
