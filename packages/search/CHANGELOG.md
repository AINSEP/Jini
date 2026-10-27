# @jini-ai/search

## 0.6.13

### Patch Changes

- 0728914: Engine guard clean-up (`pnpm guard` 106 -> 0): layer, subpath-isolation and module-state findings fixed by moving
  shared contracts to their owners instead of reaching across domains. Additive public API: `@jini-ai/core/filesystem`
  (guarded-reader contracts), `useFetchQueryScope` from `@jini-ai/ui` fetch-query (per-provider query scope),
  `@jini-ai/chat/react` re-exports of the accepted-input, run-state and agent-plugin chat-state helpers. The Claude
  filesystem probe cache in `@jini-ai/agent-runtime` is instance-owned. No behaviour change intended; host-facing
  breaks are listed in `owner-store-to-server` and `guard-host-ports`.
- Updated dependencies [7479159]
- Updated dependencies [c31264d]
- Updated dependencies [0728914]
- Updated dependencies [6ecbdb2]
- Updated dependencies [63bacc5]
  - @jini-ai/core@0.6.13

## 0.6.12

### Patch Changes

- @jini-ai/core@0.6.12

## 0.6.11

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @jini-ai/core@0.6.11

## 0.6.10

### Patch Changes

- Updated dependencies [22f0619]
- Updated dependencies [82ed2d3]
- Updated dependencies [5a3de86]
  - @jini-ai/core@0.6.10
