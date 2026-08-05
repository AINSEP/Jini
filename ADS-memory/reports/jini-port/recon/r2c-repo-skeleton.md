# R2c — Fresh Jini repo skeleton + governance

Builds on `r2-packages.md` and `r2b-packages-design.md`. Grounded in verified OD facts:
- OD `.git` = **1.6 GB** (verified `du -sh`).
- Remotes: `origin=nexu-io/open-design`, `fork=leonaburime-ucla/open-design` (verified).
- Current branch `refactor/web-memory-slice`; the coordinator refers to an `integrated` branch with the daemon decomposition + `src.orig`.
- Root scripts: only `guard` (tsx `scripts/guard.ts` + a suite of `--test` boundary tests), `typecheck` (`pnpm -r` + scripts tsconfig), and tools-* control planes. No root `build`/`test` (verified — matches AGENTS.md root-command boundary).
- `pnpm-workspace.yaml`: `packages/*`, `apps/*`, `tools/*`, `e2e`; `engines.node ~24`, `pnpm@10.33.2` (verified).
- Guards are AST-based (`typescript` `ts.resolveModuleName`, `repoRoot = path.resolve(import.meta.dirname, "..")`, allowlist arrays). `check-cross-app-imports.ts` and `check-web-slice-boundaries.ts` are the models.

Read-only recon; nothing edited.

---

## 1. Top-level Jini folder tree

```
jini/
├── packages/                         # THE ENGINE — every dir here is product-neutral @jini/*
│   ├── protocol/                     # @jini/protocol  (generic core carved from OD contracts)
│   ├── platform/                     # @jini/platform
│   ├── sidecar/                      # @jini/sidecar
│   ├── sidecar-proto/                # @jini/sidecar-proto  (neutral, identity injected)
│   ├── release/                      # @jini/release        (neutral, identity injected)
│   ├── components/                   # @jini/components     (react peer)
│   ├── download/                     # @jini/download
│   ├── diagnostics/                  # @jini/diagnostics
│   ├── metatool/                     # @jini/metatool
│   ├── registry-protocol/            # @jini/registry-protocol
│   ├── plugin-runtime/               # @jini/plugin-runtime
│   ├── agui-adapter/                 # @jini/agui-adapter   (optional)
│   └── host/                         # @jini/host           (optional; drop if no desktop)
│
├── integrations/
│   └── open-design/                  # THE OD ADAPTER — everything product-coupled lives here
│       ├── contracts/                # @od/contracts  (the ~85 OD files: api/*, prompts/, analytics/, design-systems/, plugins/, OD sse unions, examples) → depends on @jini/protocol
│       ├── identity/                 # @od/identity   (product-name/appId/OD_* env/--od-stamp-* config injected into @jini/release + @jini/sidecar-proto)
│       ├── daemon/                   # the OD product daemon (the valuable `integrated` decomposition) → consumes @jini/*
│       ├── web-slice/               # OD-specific web feature slices (product chat surface config, OD panels)
│       └── launcher-proto/           # OD packaged-launcher glue (--od-launcher-*)
│
├── apps/
│   └── reference-web/                # Vite + React 18 reference host (NOT Next.js — see note)
│
├── examples/
│   └── minimal-host/                 # smallest app that imports ONLY @jini/* — proves zero-OD reuse
│
├── project-runner/                   # standalone runner harness
├── AI-Dev-Shop/                      # top-level product surface (per coordinator)
│
├── docs/
│   ├── architecture.md
│   ├── extraction-provenance.md      # index into per-package source-map.md
│   └── AGENTS.md                     # Jini's directory guide (mirror OD's pattern)
│
├── tools/
│   └── dev/                          # lifecycle control plane (if kept; else scripts)
│
├── scripts/
│   ├── guard.ts                      # aggregator (model on OD scripts/guard.ts)
│   ├── check-engine-boundaries.ts    # NEW — the @jini/** isolation guard (see §3)
│   ├── check-engine-boundaries.test.ts
│   ├── check-protocol-purity.ts      # NEW — @jini/protocol must not import api/* (see §3)
│   ├── source-check.ts               # residual .js allowlist (model on OD)
│   └── tsconfig.json
│
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── LICENSE                           # Apache-2.0
├── NOTICE                            # credits nexu-io/open-design
└── AGENTS.md / CLAUDE.md
```

**Vite note (verified-adjacent):** the OD chat surface renders through `apps/web/src` React with no Next.js runtime import inside the slice files (the web-slice boundary guard already forbids `window`/`document`/transport in slices, and OD's `apps/web` is App-Router but the *feature slices* are transport-free React). So a Vite host is a clean swap: `examples/reference-web` is a Vite SPA that mounts the same React slices; only the Next-specific app-shell (routing/SSR/`app/` dir) is dropped. Lower memory footprint is the stated driver.

**Workspace globs** cover: `packages/*`, `foundry/integrations/open-design/*`, `apps/*`, `examples/*`, `project-runner`, `AI-Dev-Shop`, `tools/*`.

---

## 2. `pnpm-workspace.yaml` + root `package.json`

**`pnpm-workspace.yaml`:**
```yaml
packages:
  - packages/*
  - foundry/integrations/open-design/*
  - apps/*
  - examples/*
  - project-runner
  - AI-Dev-Shop
  - tools/*
onlyBuiltDependencies:
  - better-sqlite3   # only if @od/daemon keeps SQLite
  - esbuild
  - sharp
```
(Carry OD's `overrides:` block only for CVEs that still apply to retained deps — audit, don't copy wholesale.)

**Root `package.json` (scripts boundary = guard/typecheck only):**
```jsonc
{
  "name": "jini",
  "private": true,
  "packageManager": "pnpm@10.33.2",
  "engines": { "node": "~24", "pnpm": ">=10.33.2 <11" },
  "scripts": {
    "guard": "tsx ./scripts/guard.ts && node --import tsx --test scripts/check-engine-boundaries.test.ts scripts/check-protocol-purity.test.ts",
    "typecheck": "pnpm -r --workspace-concurrency=4 --if-present run typecheck && tsc -p scripts/tsconfig.json --noEmit"
  }
}
```
Rules mirrored from OD: **no root `build`/`test`/`dev`** — build and test stay package-scoped (`pnpm --filter @jini/<pkg> build`). Only repo-wide checks (`guard`, `typecheck`) and tool control planes live at root. Each package owns `build` (esbuild) + `typecheck` + `test` (vitest) exactly as OD packages do today.

---

## 3. Boundary-enforcement guard: `scripts/check-engine-boundaries.ts`

Model directly on `scripts/check-cross-app-imports.ts` + `check-web-slice-boundaries.ts`: AST-parse every source file with `typescript`, extract static `import`, dynamic `import()`, `import(...).Type`, and `require()` specifiers, resolve each with `ts.resolveModuleName` against the file's tsconfig (so path aliases / `imports` subpaths can't smuggle a violation), classify the resolved target by which top-level dir it lands in, and fail on forbidden edges. `repoRoot = path.resolve(import.meta.dirname, "..")`.

**Rule set:**

- **R1 — Engine isolation (the core invariant).** Any file under `packages/@jini/**` (i.e. all of `packages/*`) MUST NOT import from `apps/**`, `integrations/**`, `examples/**`, `project-runner/**`, or `AI-Dev-Shop/**`. The engine depends downward on nothing product-specific. Violations fail hard.

- **R2 — Engine intra-graph legality.** A `packages/<pkg>` may import another `packages/<other>` ONLY via its public package name (`@jini/other`), never a deep path (`@jini/other/src/...` / relative `../other/src`). Mirrors OD's "no cross-slice deep imports; barrel only." Enforce the allowed adjacency list from `r2b` §4 (e.g. `@jini/download → @jini/platform` ok; `@jini/platform → @jini/anything` forbidden — it's a leaf).

- **R3 — Protocol purity (the riskiest edge you flagged).** Delegated to a dedicated `check-protocol-purity.ts` (kept separate like OD splits guards): every file under `packages/protocol/**` MUST NOT import anything that resolves into an OD `api/*` DTO, OD `prompts/*`, OD `analytics/*`, OD `design-systems/*`, or anything under `integrations/**`. The generic core (`common`, `errors`, `tasks`, `execution-profile`, `critique`, `sse/common`, `agent-tools/*`) may import only `zod` and its own internal files. This enforces the **downward-only edge**: `@od/contracts → @jini/protocol` is legal; `@jini/protocol → @od/*` is a build-breaking violation. (This is the exact seam that a sloppy `index.ts` barrel split would reopen.)

- **R4 — Integration direction.** `foundry/integrations/open-design/**` MAY import `@jini/*` (that's the point) but MUST NOT be imported *by* any `packages/@jini/**` file (redundant with R1, but stated so the guard reports the integration-side offender too). It also must not import `apps/**`.

- **R5 — No product identity strings in engine.** Static-string scan (like OD's `product-neutrality.test.ts`): fail if any `packages/@jini/**` source literal contains `Open Design`, `open-design`, `OD_`, `--od-stamp`, `/tmp/open-design`, `io.open-design`, or `OpenDesignHost`. Forces identity to live in `@od/identity` and be injected (per `r2b` §3). Small curated allowlist array for legitimate mentions (none expected in engine).

- **R6 — Residual JS allowlist.** Port OD's `.js/.mjs/.cjs` residual guard + esbuild-config allowlist so generated/vendor JS is the only non-TS source.

Each rule returns typed violations `{ filePath, lineNumber, specifier, reason }`; `guard.ts` aggregates and exits non-zero on any. A companion `.test.ts` (per OD pattern) feeds fixture files proving each rule fires — including a red fixture where `packages/protocol` imports an `api/chat` shape (R3) and one where `packages/platform` imports `foundry/integrations/open-design/daemon` (R1).

---

## 4. Provenance / licensing

- **LICENSE:** `Apache-2.0` (OD's license permitting; confirm OD's actual license before finalizing — verify OD `LICENSE` file at extraction time). Apache-2.0's §4(b)/(d) NOTICE-propagation obligation is the mechanism that keeps upstream credit attached.
- **NOTICE (root):** states "Portions of this work are derived from Open Design (https://github.com/nexu-io/open-design), © its contributors, used under <OD's license>." Lists which `@jini/*` packages are derived vs original.
- **Per-package `source-map.md`** in each derived package (`packages/<pkg>/source-map.md`), table: `jini path | OD source path | OD origin commit SHA | transform (verbatim / renamed-identity / split)`. Example row: `packages/protocol/src/errors.ts | packages/contracts/src/errors.ts | <sha> | verbatim`. `docs/extraction-provenance.md` indexes all per-package maps.
- **Authorship preservation — use `git format-patch`, not copy+paste.** For each package, in an OD clone: `git log --follow --format=%H -- packages/<pkg>/src` to get history, then `git format-patch` / `git am` (or `git filter-repo --path packages/<pkg> --path-rename packages/<pkg>:packages/<newname>`) to replay commits into the Jini repo so the original author/date/commit trailers survive. `git filter-repo` with `--path-rename` is the cleanest for the leaf packages (platform, components, etc.) that move nearly verbatim. For `@jini/protocol` (a *partial* file-set carved out of `contracts`), filter-repo with a `--path` include-list of exactly the 8 generic files + `agent-tools/` dir preserves their individual histories while dropping the 85 OD files. Renames (identity scrub, `.od-*` CSS) land as *follow-on* commits authored by the extractor, so blame cleanly separates "OD original" from "Jini de-coupling."

---

## 5. Referencing OD for ongoing sync without bloating Jini (`.git` = 1.6 GB)

**Do NOT git-submodule OD into Jini** — that drags the full 1.6 GB history into every clone and couples Jini's DX to OD's monorepo weight. Recommendation, in order:

1. **Primary: a separate, blobless local OD mirror** kept *outside* the Jini working tree: `git clone --filter=blob:none https://github.com/nexu-io/open-design.git ../open-design-upstream`. Blobless keeps the commit/tree graph (needed for `format-patch`/cherry-pick provenance) but fetches blobs on demand — a fraction of 1.6 GB. Jini's repo stays clean; sync tooling points at this sibling mirror.
2. **For a one-time extraction pass:** `git clone --filter=tree:0 --sparse` (no-checkout + sparse) then `git sparse-checkout set packages/<pkg>` per package — pull only the paths being extracted.
3. **Reject full submodule / full clone in-tree** given the 1.6 GB cost (matches the user's memory note about heavy-repo worktree/disk cost).

**Upstream-fix pull mechanism over time:** maintain a `docs/upstream-sync.md` per-package "last-synced OD commit" watermark (the `origin commit` column in `source-map.md` IS this watermark). A `scripts/sync-upstream.ts` control-plane: for package P, `git -C ../open-design-upstream log <watermark>..origin/main -- <OD-path>` lists new upstream commits touching P's source; the maintainer reviews and `git format-patch <watermark>..HEAD -- <OD-path>` → `git am -3` into Jini (rebasing across the identity-rename follow-on commits, which may conflict — expected, resolved once). Advance the watermark. This keeps Jini a *curated fork of specific files*, not a live mirror, so OD's product churn (new api DTOs, prompts) never floods the engine.

---

## 6. Migration bootstrap (Jini currently IS a dirty OD copy on `integrated`)

Current reality (verified): this checkout has OD `origin`/`fork` remotes, a 1.6 GB OD `.git`, is on `refactor/web-memory-slice` (coordinator references a separate `integrated` branch carrying the daemon decomposition + `src.orig`), and untracked `ADS-project-knowledge/`, `docs/jini-open-design-porting-plan.md`.

**Recommendation: fresh empty repo (gut-down loses nothing and inherits 1.6 GB + OD remotes + OD identity). Steps:**

1. **Preserve the valuable `integrated` work first, out-of-tree.** Before any wipe, from the OD checkout create bundles so nothing is lost:
   - `git bundle create ../integrated-daemon.bundle integrated` (full branch history of the daemon decomposition).
   - Tar `src.orig` and any uncommitted valuable dirs (`ADS-project-knowledge/`, `docs/jini-open-design-porting-plan.md`) to `../jini-preserve/` — these are untracked, so they'd vanish on a clean clone.
   - Push `integrated` to the `fork` remote as a safety net (`git push fork integrated:archive/integrated-daemon`).
2. **Fix the broken symlink** noted by the coordinator (Tovu symlink) — do not carry a dangling link into the new repo; record its intended target in `docs/` if it mattered, else drop it.
3. **Create a brand-new empty repo** (`git init jini`) — NOT a clone. This gives Jini a clean 0-byte history, no OD remotes, no 1.6 GB baggage, and lets Apache-2.0 + NOTICE be the first commits.
4. **Populate via `git filter-repo`/`format-patch` from the sibling blobless OD mirror** (§4/§5), one `@jini/*` package at a time in the dependency order from `r2b` §4, so each lands with preserved authorship.
5. **Re-import the `integrated` daemon decomposition** into `foundry/integrations/open-design/daemon/` from `../integrated-daemon.bundle` (`git fetch ../integrated-daemon.bundle integrated:od-daemon-import`, then filter to the daemon path). `src.orig` becomes a reference under `foundry/integrations/open-design/daemon/.reference/` or is discarded once the decomposition is confirmed.
6. **Wire remotes:** Jini gets its own `origin` (new GitHub repo); the OD blobless mirror stays a *sibling directory*, never a Jini remote/submodule.
7. **First green gate:** stand up `scripts/check-engine-boundaries.ts` + `check-protocol-purity.ts` and run `pnpm guard && pnpm typecheck` before adding `examples/reference-web`, so the boundary invariants are enforced from commit 1, not retrofitted.

Why fresh-repo over gut-down: a gut-down (delete files, keep `.git`) inherits the 1.6 GB history, the OD `origin`/`fork` remotes, and OD's identity in old commits — exactly the bloat and coupling this whole extraction is trying to shed. Fresh init + provenance-preserving replay gives clean history AND keeps authorship where it matters (per-file `format-patch`).

---

### Verified vs inferred
- **Verified:** `.git`=1.6 GB, remotes, current branch, root scripts (guard/typecheck only, no root build/test), workspace globs, engines, guard scripts are AST/`ts.resolveModuleName`-based with allowlist arrays, `source-check.ts`/`product-neutrality.test.ts` exist as models.
- **Inferred:** the `integrated` branch contents (daemon decomposition + `src.orig`) and the Tovu symlink are taken from the coordinator's description — not directly inspected in this checkout (current branch is `refactor/web-memory-slice`; `*.orig` search hit only `node_modules`). OD's exact license text must be read before asserting Apache-2.0 compatibility. Vite-cleanliness is inferred from the web-slice transport-free guard, not from building a Vite host.
