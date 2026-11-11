# @jini-ai/search

## 0.7.1

### Patch Changes

- Updated dependencies [873f10c]
  - @jini-ai/core@0.7.1

## 0.7.0

### Patch Changes

- Updated dependencies [fedca02]
- Updated dependencies [11ce174]
- Updated dependencies [8fe045b]
- Updated dependencies [c393010]
- Updated dependencies [ce9e9dc]
- Updated dependencies [1838089]
- Updated dependencies [df2698c]
- Updated dependencies [4044fe3]
- Updated dependencies [0ccd93c]
- Updated dependencies [a6e4a75]
- Updated dependencies [42cfff7]
- Updated dependencies [41ff2ff]
- Updated dependencies [a266ba8]
- Updated dependencies [291a220]
- Updated dependencies [27063ef]
- Updated dependencies [6ab1d81]
- Updated dependencies [699b478]
- Updated dependencies [1cf0306]
- Updated dependencies [39cf677]
  - @jini-ai/agent-plugins@0.7.0
  - @jini-ai/core@0.7.0

## 0.6.19

- Released with the fixed `@jini-ai/*` group; no changes of its own.

## 0.6.17

### Patch Changes

- Version bump only.

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
