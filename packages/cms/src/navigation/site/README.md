# cms/navigation/site

## Wiring

- `reverters.ts`: `registerMenuReverters({ registry, deps })` — the host injects `deps` (`menuRepo`, `clock`, `idGen`, `outbox`) and its `RevertRegistry` in its site-provider composition.
