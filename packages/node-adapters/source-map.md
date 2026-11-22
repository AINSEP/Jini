# `@jini-ai/node-adapters` source map

Created by sheet N1 (owner decision OD-3). Both files moved from `@jini-ai/platform` (`src/runtime-ports/`)
with history (`git mv`); they came from daemon lane R8a step 1. The only edits are the imports (relative
`../fs/*` and `../process.js` became the `@jini-ai/platform/fs` and `@jini-ai/platform/process` entries)
and the sentence that named the old `./runtime-ports/*` entries.

| File | Public entry | Responsibility |
| --- | --- | --- |
| `src/fs.ts` | `./fs` | `nodeFileLock`, `nodeAtomicWriter`: naming maps from platform functions to core's file-lock and atomic-writer ports. |
| `src/process.ts` | `./process` | `createProcessControlPort` (argument-shape adapter over three injected functions; the host passes platform's, XC-6a removed the pre-bound `nodeProcessControl`); `createSpawnPort` / `nodeSpawnPort` (Node's positional `spawn` as the object-argument spawn port, child returned in the same turn) and `nodeCommandShell` (the planner's platform + `ComSpec`, from the host's own env). Added by daemon R8a step 5; they were written in `platform/runtime-ports/process.ts` on `wave2/daemon-r8` before the N1 move. |
| `src/__tests__/runtime-ports.test.ts` | | Recording-fake argument-shape tests plus real-function tests (moved unchanged apart from import paths). |
| `src/__tests__/runtime-ports.typecheck.ts` | | Compile-time proof that the platform functions still satisfy the three ports. |
| `src/__tests__/surface.test.ts` | | Pins the manifest `exports` keys, their dist/src mapping and each entry's exported names. |

Left in `@jini-ai/platform`: `src/__tests__/core-contracts.typecheck.ts` (the `RuntimePlatform` and
`LocalBlobStorage` compile-time checks that shared the old typecheck file; they are about platform, not the bindings).
Stays in `@jini-ai/server`: `src/adapters/node-pty.ts` (native dependency).
