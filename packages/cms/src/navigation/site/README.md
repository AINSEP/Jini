# cms/navigation/site

## Wiring

- `reverters.ts`: `registerMenuReverters({ registry, deps })` — the host injects `deps` (`menuRepo`, `clock`, `idGen`, `outbox`) and its `RevertRegistry` (Tovu: `server/runtime/composition/site-deps/route-deps-site-providers.ts`).
