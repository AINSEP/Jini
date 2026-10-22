Spec ID: SPEC-JINI-ARTIFACTS-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:7e7c41d16a7085ccfcf4d5ddc694b9c2553d83a92164769b00f80a0e7da4c7fa
spec_mode: reverse_spec


# State contract: artifacts

## Reference store

`createInMemoryArtifactStore` creates an independent empty map. Name is the key; create is overwrite, get is nullable, list returns current records sorted by manifest update string. No delete, event subscription, persistence, transaction, TTL, capacity bound or shutdown API exists.

Manifest lifecycle labels `streaming`, `complete`, `error` are accepted data, not a guarded transition machine. Consumers can overwrite a completed record with streaming/error content. Creates are not request-idempotent: timestamps refresh and no request key is stored.

Records, manifests and byte arrays are returned by reference; TypeScript readonly annotations do not freeze runtime values. A consumer that needs snapshot isolation must copy them. Process exit loses all records.

## Text suppressor

Fresh instance: suppression false, empty candidate, zero counters. `strip` either emits ordinary text, retains a possible partial tag or consumes hidden text. Matching open/close delimiters transitions suppression. `flush` clears the candidate only; it does not reset suppression or cumulative counters. No reset or persistence exists; discard after one stream.

Current recursive argument mismatch prevents promising the complete open → hidden → close lifecycle; see `behavior.spec.md`. Do not share an instance across unrelated streams.

## Disk observations

The Node stub scanner reads files and optional `<filename>.artifact.json` sidecars on demand. It owns no persistent cache and writes nothing. The consumer must scan prior content before replacing it and coordinate concurrent writers itself.

Evidence: `src/store.ts`, `src/text-suppression.ts`, `src/node/stub-guard.ts` and source tests.
