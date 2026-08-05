# Handoff: design-systems/ Subdirectory Refactor

**Branch:** `arch/chatrun-service-extraction`
**Status:** In progress — file reorganization not yet committed; tests passing at 96/96

---

## What we're doing and why

`apps/daemon/src/design-systems/` started as a 13-file flat namespace. The goal is to reorganize it into meaningful domain subdirectories so codebase analyzers, AI agents, and humans can navigate it quickly. We're also adding `@module` JSDoc docblocks to every file and 2–3 sentence descriptions in every barrel `index.ts`.

The reorganization follows a **strangler-fig pattern**: no logic changes, only moves + import-path fixes.

---

## Work already complete (prior sessions)

### New subdirectory files already written and typechecking:

| File | Domain |
|---|---|
| `src/design-systems/core/types.ts` | TypeScript interfaces + `LEGACY_DESIGN_SYSTEM_ARTIFACTS` |
| `src/design-systems/core/file-utils.ts` | Filesystem helpers, path sanitization, manifest parsing |
| `src/design-systems/core/body.ts` | Pure text/Markdown transforms, HTML escaping, renderers |
| `src/design-systems/core/index.ts` | Barrel re-exporting all core types |
| `src/design-systems/catalog/reader.ts` | Reads design systems from directories |
| `src/design-systems/catalog/assets.ts` | LRU-cached runtime asset resolution |
| `src/design-systems/catalog/index.ts` | Barrel for reader + assets |
| `src/design-systems/user/registry.ts` | CRUD for user design systems |
| `src/design-systems/user/revisions.ts` | Revision metadata, atomic writes |
| `src/design-systems/user/migration.ts` | Legacy package migration |
| `src/design-systems/user/ui-kit.ts` | JSX role component rendering |
| `src/design-systems/user/index.ts` | Barrel re-exporting 10 registry functions |
| `src/design-systems/index.ts` | Root barrel re-exporting from core/catalog/user barrels |
| `src/design-systems/server-services.ts` | Stays at root — no changes needed |

### Tests (all 96/96 passing):

Located in `apps/daemon/tests/design-systems/__tests__/` (nested under `__tests__/` per user preference — user said "leave the tests where they are"):

- `core/body.test.ts` — 30 tests
- `core/file-utils.test.ts` — 20 tests
- `user/migration.test.ts` — 10 tests
- `user/revisions.test.ts` — 21 tests
- `user/ui-kit.test.ts` — 10 tests

Test import pattern: `../../../../src/design-systems/...` (4 levels up from `tests/design-systems/__tests__/{core|user}/`)

---

## Work remaining (this session was mid-move when context ran out)

### Step 1 — Directories to create (already created in prior session)

```
src/design-systems/core/   ✓
src/design-systems/catalog/ ✓
src/design-systems/user/   ✓
src/design-systems/import/ ← needs to be created
src/design-systems/tokens/ ← needs to be created
src/design-systems/jobs/   ← needs to be created
```

### Step 2 — Flat files to move with their target paths

All 13 flat files still sit at `src/design-systems/*.ts` and must be moved to subdirectories. Full content has been read; import changes documented below.

#### `core/` group (pure, no cross-design-systems imports)

| Source | Target | Import changes |
|---|---|---|
| `frontmatter.ts` | `core/frontmatter.ts` | None (pure) |
| `swift-colors.ts` | `core/swift-colors.ts` | None (pure) |
| `rename-args.ts` | `core/rename-args.ts` | None (pure) |

#### `catalog/` group

| Source | Target | Import changes |
|---|---|---|
| `source-context.ts` | `catalog/source-context.ts` | `'./index.js'` → `'../index.js'` (line 1) |
| `showcase.ts` | `catalog/showcase.ts` | None (pure) |
| `preview.ts` | `catalog/preview.ts` | None (pure) |

#### `import/` group

| Source | Target | Import changes |
|---|---|---|
| `import.ts` | `import/import.ts` | `'./token-contract.js'` → `'../tokens/token-contract.js'`; `'./token-evidence.js'` → `'../tokens/token-evidence.js'` |
| `github-import.ts` | `import/github-import.ts` | `'./import.js'` stays `'./import.js'` (same folder) |
| `shadcn-import.ts` | `import/shadcn-import.ts` | `'./import.js'` stays `'./import.js'` (same folder) |

#### `tokens/` group

| Source | Target | Import changes |
|---|---|---|
| `token-contract.ts` | `tokens/token-contract.ts` | Only `@open-design/contracts` imports — no change |
| `token-evidence.ts` | `tokens/token-evidence.ts` | Only `node:path` import — no change |

#### `jobs/` group

| Source | Target | Import changes |
|---|---|---|
| `token-contract-rebuild.ts` | `tokens/token-contract-rebuild.ts` | `'./index.js'` → `'../index.js'` (line 5) |
| `generation-jobs.ts` | `jobs/generation-jobs.ts` | `'./index.js'` → `'../index.js'` (line 13); `'./source-context.js'` → `'../catalog/source-context.js'` (line 15–19) |

### Step 3 — Fix cross-references in already-written files

Two already-written files have import paths that will break once the flat files move:

- `catalog/reader.ts`: `'../frontmatter.js'` → `'../core/frontmatter.js'`
- `core/body.ts`: `'../swift-colors.js'` → `'./swift-colors.js'` (swift-colors now lives in core/)

### Step 4 — Create new barrel files

Create `import/index.ts`, `tokens/index.ts`, `jobs/index.ts` with module descriptions (2–3 sentences per export per AGENTS.md spec).

Update `core/index.ts` to add frontmatter, swift-colors, rename-args exports with descriptions.

Update `catalog/index.ts` to add source-context, showcase, preview exports with descriptions.

Update root `design-systems/index.ts` to re-export from the new barrels.

### Step 5 — Update 7 external files

These are files outside `design-systems/` that directly imported the flat files (not through the barrel):

| File | Changes needed |
|---|---|
| `apps/daemon/src/routes/design-systems.ts` | `'../design-systems/token-contract-rebuild.js'` → `'../design-systems/tokens/token-contract-rebuild.js'`; `'../design-systems/generation-jobs.js'` → `'../design-systems/jobs/generation-jobs.js'` |
| `apps/daemon/src/routes/static-resource.ts` | `import.js` → `import/import.js`; `github-import.js` → `import/github-import.js`; `shadcn-import.js` → `import/shadcn-import.js`; `preview.js` → `catalog/preview.js`; `showcase.js` → `catalog/showcase.js` |
| `apps/daemon/src/skills.ts` | `'./design-systems/frontmatter.js'` → `'./design-systems/core/frontmatter.js'` |
| `apps/daemon/src/cli.ts` | `'./design-systems/rename-args.js'` → `'./design-systems/core/rename-args.js'` |
| `apps/daemon/src/server.ts` | `generation-jobs.js` → `jobs/generation-jobs.js`; `token-contract-rebuild.js` → `tokens/token-contract-rebuild.js`; `preview.js` → `catalog/preview.js`; `showcase.js` → `catalog/showcase.js` |
| `apps/daemon/src/plugins/atoms/design-extract.ts` | `'../../design-systems/token-evidence.js'` → `'../../design-systems/tokens/token-evidence.js'` |
| `apps/daemon/src/memory.ts` | `'./design-systems/frontmatter.js'` → `'./design-systems/core/frontmatter.js'` |

### Step 6 — Delete the 13 flat source files

### Step 7 — Typecheck

```bash
pnpm --filter @open-design/daemon exec tsc -p tsconfig.json --noEmit
```

Fix any errors that surface.

### Step 8 — Run tests

```bash
pnpm --filter @open-design/daemon test
```

Confirm the 96+ design-systems tests still pass (and that the pre-existing failing tests listed below are no different).

---

## Pre-existing failing tests (NOT caused by this refactor)

From `apps/daemon/tests/` — these were already failing on `main` before this work:

- `tests/chat-run-sse-shapes.test.ts` — 4 failing
- `tests/run-resume-on-failure.test.ts` — 1 failing
- `tests/run-retry-runtime.test.ts` — 2 failing

Do not count these as regressions.

---

## Open design question: `types/` subfolder

User asked whether to introduce a dedicated `types/` subdirectory for interfaces.

**Recommendation:** Do this only for `core/types.ts`, which contains genuinely cross-cutting domain types (`DesignSystemSurface`, `DesignSystemStatus`, `UserDesignSystemMetadata`, etc.) with no implementation coupling. Split into:

```
core/types/
  domain.ts      — DesignSystemSurface, status enums, metadata interfaces
  files.ts       — DesignSystemFileDetail, DesignSystemFileSummary, etc.
  index.ts       — barrel
```

Leave all per-domain types (`DesignTokenBinding` in `tokens/`, `DesignSystemGenerationJob` in `jobs/`, etc.) co-located with their builders. Creating a `types/` folder for those would cause circular imports and violate the "types live where they're constructed" TypeScript convention.

This change can be done as a second pass once the flat-file reorganization is complete and typechecks clean.

---

## File-level docblocks (Haiku-generated, ready to prepend)

All 23 files have pre-approved `@module` docblock text from the prior session. They replace existing comment blocks at the top of each file. Format:

```ts
/** @module <name>
 * <sentence 1>. <sentence 2>. [<sentence 3>.]
 */
```

The docblock text for each file is in the prior conversation context (search "Haiku docblocks ready for all 23 files").

---

## Key constraints from AGENTS.md

- Tests live in `apps/daemon/tests/` (never `src/`) — vitest config scans `tests/**`
- All local imports in `.ts` files use `.js` extension (Node ESM)
- No `@ts-nocheck` — all new files strictly typed
- Shared types/DTOs belong in `packages/contracts`, not daemon-internal modules
- `server-services.ts` stays at root — it is a thin adapter, not domain logic

---

**To resume:** Start at Step 1 above (create `import/`, `tokens/`, `jobs/` directories), then write each file using Write tool, then update external files, delete flat sources, and typecheck.

---

## Session decisions saved to project memory

The following were saved to `~/.claude/projects/.../memory/` on 2026-07-02 so future sessions inherit them automatically:

| Memory file | What it records |
|---|---|
| `project_design_systems_refactor.md` | Full status of this refactor, pattern conventions, open design decisions |
| `feedback_test_structure.md` | Tests stay nested in `__tests__/{core,user}/` — user overrode AGENTS.md flat rule |
| `feedback_haiku_delegation.md` | Delegate mechanical generation (docblocks, barrel descriptions) to Haiku 4.5 subagents |

The `server.ts decomposition` memory (`project_server_ts_decomposition.md`) already existed from a prior session and covers the broader strangler-fig context this refactor is part of.
