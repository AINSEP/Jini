Spec ID: SPEC-JINI-PROTOCOL-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:06081a86bce7712ecc59367bdb16d5d772ccc38419b3b2cf2a45961a0628ea4e
spec_mode: reverse_spec


# Protocol behavior contract

## Deterministic rules

- The terminal-state helper shall return true only for succeeded, failed and cancelled.
- WHEN a host encodes context, the encoder shall prepend `jini-run-context:v1:` to `JSON.stringify(payload)` without size limiting, escaping beyond JSON encoding, or transport I/O.
- IF a context string has another prefix, invalid JSON, invalid prompt type or non-array history, THEN the decoder shall return `undefined`.
- WHEN context decoding succeeds, the decoder shall discard extra top-level fields and preserve history entries without deeper validation.
- WHEN an error helper runs, it shall construct a plain payload without throwing an application error, selecting an HTTP status, sanitizing text, or checking code membership.
- WHEN a registry schema parses an omitted search query, it shall supply `''`; omitted verification shall become false; omitted publish changedFiles/warnings and yank warnings shall become empty arrays.
- IF search limit is supplied outside integer 1–500, THEN registry parsing shall fail rather than clamp it.
- WHEN registry metadata schemas marked passthrough parse extra keys, they shall retain them; other object schemas shall strip extra keys.

## Port guarantees and boundaries

The EventLog interface shall describe ordered per-run replay and optional producer deduplication; the host's adapter shall implement those promises. Registry interfaces shall use asynchronous returns for every operation. This package shall supply neither adapter.

The package shall not start runs, enforce valid run transitions, cancel subprocesses, emit/replay events, perform signature verification, resolve version ranges, access storage/network, refresh credentials, or render UI. Types shall not validate their own runtime values. `BoundedJsonConstraints` shall describe limits without enforcing them.

`RunState` uses `cancelled`; `RunEndPayload.status` uses `canceled`. Consumers shall map those spellings explicitly when crossing the two shapes. Journal trust/provenance consistency remains a host responsibility. Resolved registry schemas reject verification identity metadata unless `verified` is explicitly true; cryptographic verification remains the backend's responsibility.

## Known contract limits

`ResolvedRegistryEntrySchema` accepts `verified:false` with issuer/subject fields, despite comments saying those fields are present only for verified entries (`src/registry.ts`). `RunAgentPayload` documentation describes an older MCP stringify behavior (`src/events.ts`); consumers must use the actual producer/wrapper contracts for withheld surfaces. No deadlines, throughput limits, retention defaults or retry policy are implemented here.

Evidence: `src/run.ts`, `run-context.ts`, `errors.ts`, `registry.ts`, `events.ts`; static tests under `src/__tests__/`. Runtime verification was not run.
