# R5 — Tovu / Tovu-Runner recon (read-only)

Scope: `/Users/la/Desktop/Programming/Tovu` and `/Users/la/Desktop/Programming/Tovu-Runner`.
Engine under extraction = "Jini" (the open-design checkout). VERIFIED that
`Tovu-Runner/scripts/dev.sh` defaults the engine to
`$HOME/Desktop/Programming/OSS-Repos/Jini`, i.e. Jini is the renamed/extracted
open-design engine. Our cwd is the `open-design` checkout of that same engine.

Legend: **[V]** = verified by reading a file. **[I]** = inferred.

---

## 0. Naming is inverted from intuition — read this first

The two directories do NOT map to "product + its runner". They are two different
kinds of thing:

- **`/Users/la/Desktop/Programming/Tovu`** — package `"tovu"` **[V** `package.json`**]**.
  This is the **website product**: a WordPress-like CMS runtime (public site +
  per-site admin + content model). **START-HERE.md [V]**: "Tovu = the website
  product … It is **not** the desktop host (that's the sibling `Tovu-Runner`
  repo)". This is an **independent domain product**, NOT a fork of the OD engine.

- **`/Users/la/Desktop/Programming/Tovu-Runner`** — package `"tovu-workspace"`,
  described **[V** `package.json`**]** as *"Tovu — UI on the open-design engine.
  Run daemon and web as independent foreground processes."* This is the
  **desktop host / operator shell** and is the **actual second consumer of the
  OD (Jini) engine**. It owns multi-site management, media/video generation,
  agent detection, and the operator chat (per Tovu's START-HERE.md).

Dependency arrow (Tovu ADR-011, **[V** START-HERE.md**]**): **Runner → Tovu,
never reverse.** The Runner hosts/manages Tovu sites; Tovu never imports Runner.

So when the task says "OD and Tovu genuinely SHARE," the honest split is:
- **Engine-code sharing** happens between OD/Jini and **Tovu-Runner** (it reuses
  the daemon + web shell + `@open-design/*` wholesale — see §3).
- **Tovu (the CMS product)** shares **patterns, not code** with OD (§4).

---

## 1. What IS Tovu (the product, `/Tovu`)?

**Domain [V]:** a self-hostable, WordPress-like **CMS / website product**.
`package.json#description`: *"CMS runtime (public site + per-site admin + content
model)."* START-HERE: the v1 slice is the "standalone single-binary happy path" —
site-as-folder (`config.json` + `content.db` + `uploads/` + `themes/`), content
model (`post`+`page`), a React declarative-theme renderer, an admin auth boundary,
and a `tovu` binary that boots an install dir and serves site+admin.

**Stack [V** `package.json`, `apps/admin/package.json`**]:**
- Backend: **Express 4** + **Drizzle ORM** + **better-sqlite3** (SQLite-first,
  Postgres-portable), **liquidjs** (templating), **sharp** (image transforms),
  **argon2** (auth). CommonJS, `tsx`/`tsc`, node `--test`.
- Admin UI: `apps/admin` = `tovu-admin-shell`, **React 19 + Vite 7 + TipTap**
  editor. A second historical shell path exists (`nextjs/` WP-shaped + `vue/`
  proof) but the live admin is the Vite/React one.
- **No daemon, no Electron, no agent runtime** in the product itself. It is a
  plain server + admin SPA.

**Domain modules are broad and real [V** `src/` listing**]** — not a toy:
`comments/` (ingress, spam heuristic, sanitize), `newsletter/` (campaigns,
send-pipeline, confirmation, unsubscribe), `members/` (access-resolver, consent,
subscriber-directory), `forms/` (submit-service, rate-limit, notify), `media/`
(blob-store fs/memory, sharp image-transformer, rendition-service, GC locks),
`identity/` (argon2 hasher, permissions/grants, auth-service), `analytics/`
(ingest, salted), `seo/` (sitemap, page-head-contributor), `redirects/`,
`navigation/` (menu-service, resolver), plus `features/{content-types, entries,
post, presentation, taxonomy, theme, plugins, storage, workspace, settings}`.

**Architecture [V** `src/server/`, `src/core/`, INFO/spec files**]:** agent-native
modular monolith (ADR-001). Ports/adapters everywhere (each module ships
`ports.ts` + `repo.memory.ts` + `repo.sqlite.ts`). `core/` has `events/` (outbox),
`gated-mutations/`, `operation-lock.ts`, `commands/`. `server/` has
`capability-inventory.ts`, `production-readiness-gate.ts`, `bootstrap`, a
`check:inventory` script, dependency-cruiser boundary enforcement, and paired
`__tests__/` + `__specs__/` (spec-first). `workspaceId` is structural everywhere
(ADR-007). Plugins = prebuilt signed ESM + manifest, never run DDL (ADR-003/004).

**Derived from OD? NO [V].** No `@open-design/*` dependency in any Tovu
`package.json`. The earlier grep hits for the token were false positives on the
word "artifact"/"design" inside storage-journal/restore-point files, not OD
imports (verified: the three suspect files contain no `open-design`/`ChatPane`
lines). Tovu independently reinvented several OD-adjacent ideas (storage-journal,
restore-points, gated-mutations, capability-inventory) — convergent design, not
shared code.

---

## 2. Structural similarity of Tovu (product) to OD

**Low at the code level, moderate at the pattern level.**
- **No** `apps/web` + `apps/daemon` split — Tovu is one Express process + a Vite
  admin SPA (`apps/admin`). No daemon, no `od` CLI, no sidecar, no SSE run-stream.
- **No** chat/artifact/agent-runtime concepts in the product. There is no
  ChatPane/ChatComposer/question-form anywhere in `/Tovu`.
- **Shared PATTERNS** (independent, but strong signal for engine seams):
  ports/adapters with memory+sqlite dual adapters, `workspaceId` scoping,
  outbox/event decoupling, plugin = signed-ESM-manifest runtime, declarative
  themes as the default + code themes as trusted mode, SQLite-first with
  Postgres-portable schema, spec-first/test-first module discipline
  (`__specs__/`+`__tests__/`), capability-inventory as a machine-checked surface.

---

## 3. Tovu-Runner — the actual OD/Jini engine consumer

**What it is [V** `package.json`, `web/`, `scripts/dev.sh`**]:** a workspace
scaffold (`tovu-workspace`) that is the **desktop host UI built ON the open-design
(Jini) engine**. Two big pieces plus docs:

### 3a. `Tovu-Runner/web` — the OD-derived operator UI
- OD lineage is **explicit and admitted [V** `web/src/assistant/ChatFab.tsx`**]:**
  the assistant is *"a clean headless rebuild over CopilotKit — it is **not**
  ported from open-design's 5,555-line ChatComposer. That refactor comes first."*
  So Runner deliberately **rejects OD's ChatComposer/ChatPane monoliths** and
  rebuilds the chat surface on CopilotKit / AG-UI (`ChatFab.tsx`, `assistant.css`).
- `web/src/` domains **[V]:** `assistant/`, `media/` (`MediaStudio.tsx`,
  `MediaAdaptive.tsx` — real image+video generation, "model · seed · dimensions"
  generation params), `websites/` (multi-site management), `admin/`,
  `admin-shell/`, `appearance/`, `themes/`, `plugins/`, `settings/`,
  `observability/`, `analytics/`, `i18n/`, `home/`, `pages/`, `nav.tsx`,
  `server/` (Express composition root, ports/adapters, `__specs__/`).
- `web/apps/` **[V]:** `admin/`, `contract-vue/`, **`desktop/`** (Electron 43,
  `main.cjs` — OD-style desktop shell).
- `web/packages/` **[V]:** `core/` (has `kernel/ lib/ ports/ workflows/`),
  `db-sqlite/`, `renderer-react/`, `sdk/`, `server/` — but `sdk/src`, `server/src`,
  `renderer-react/src` are **empty scaffolds** (INFO.md placeholders). Per
  `web/PROJECT_MEMORY.md` **[V]**, the packages/apps/plugins/themes workspace
  extraction is **aspirational Phase 0** — live code still runs from `src/`.

### 3b. The engine binding — THE key seam finding **[V** `scripts/dev.sh`**]**
`Tovu-Runner` does not contain its own daemon. `scripts/dev.sh`:
- `ENGINE="${TOVU_ENGINE:-$HOME/Desktop/Programming/OSS-Repos/Jini}"` — the OD/Jini
  checkout is the engine.
- **daemon:** `cd $ENGINE/apps/daemon && node dist/cli.js --no-open --port 7456`
  — runs the engine's daemon binary **unchanged**.
- **web:** it **symlinks `Tovu-Runner/web/src` INTO `$ENGINE/apps/web/src`**
  (preserving the engine's UI at `src.orig`), then runs the engine's
  `next dev` with `NODE_PATH` pointed at the engine's `node_modules` so the
  swapped Tovu src resolves **`react` and `@open-design/*` from the engine**.

That is the single most important architectural fact for Jini: **the confirmed
reuse boundary is "keep the daemon + the Next web host + the `@open-design/*`
packages; swap only `apps/web/src`."** Tovu-Runner is a live proof that the OD
web `src/` is the product layer and everything under it is engine.

### 3c. `Tovu-Runner/AI-Dev-Shop` — a multi-agent coding-delivery framework
- **[V** `AI-Dev-Shop/README.md`**]:** a drop-in **multi-agent delivery pipeline**
  for coding agents (VibeCoder → CodeBase Analyzer → System Design → Spec →
  Red-Team → Architect → Database → TDD → Programmer → QA/E2E → TestRunner →
  Code Review → Refactor → Security → DevOps → Docs). `agents/` has ~21 role
  agents; `framework/` has `contracts/ governance/ memory/ operations/ reports/
  routing/ slash-commands/ spec-providers/ workflows/ templates/`;
  `harness-engineering/` has `agent-evals/ harness-evals/ hooks/ governance-
  scenarios/ policy/`. This is a **dev-time meta-orchestration harness with
  memory + reports + governance + routing**, not a product runtime.

---

## 3d. Is Tovu-Runner the "project-runner" prototype we want?

**Partially, and split across two pieces:**
- The `dev.sh` + `apps/desktop` piece is a **thin launcher** (run engine daemon +
  web in foreground / Electron shell). It is NOT a cloud task-runner or ledger.
- The **closest prototype to a Jini `project-runner` (cloud agent work + ledgers)**
  is **`AI-Dev-Shop`**: it already models orchestrated multi-agent pipelines with
  a `memory/` store, `reports/`, `routing/`, `governance/`, `workflows/`, and
  eval harnesses — i.e. the ledger/orchestration shape, but as a **prompt/agent
  framework dropped into a repo**, not a running control-plane service. Treat it
  as design input for the runner's *orchestration + ledger vocabulary*, not as a
  runnable runner to lift.

---

## 4. CONFIRMED reusable (both need) vs OD-only

### CONFIRMED shared — engine seams both OD and Tovu-Runner genuinely consume [V]
Strongest evidence = `dev.sh` reuses these three verbatim:
1. **The daemon HTTP API + `od` CLI binary** (`apps/daemon/dist/cli.js`,
   `/api/*`, `--port`, health) — agent spawning, runs, static serving. Reused unchanged.
2. **The Next.js web host shell** (`apps/web` as a shell that mounts a swapped
   `src/`). The mount-point contract (`apps/web/src`) is the product seam.
3. **The `@open-design/*` package set** resolved from engine `node_modules`
   (contracts / components / etc.). Both consumers link against it.
4. **Chat/assistant surface as a CONCEPT** — both want an operator chat that can
   drive the UI. But Tovu explicitly reuses only the *concept/backend*, not
   OD's `ChatComposer`/`ChatPane` UI monoliths (it rebuilds on CopilotKit/AG-UI).
   → Seam signal: the chat **runtime/protocol** is reusable; the current chat
   **React components are not** — Jini should expose a headless chat/runtime
   boundary, not the 5k-line composer.
5. **Media generation (image + video)** — OD has media; Runner's `MediaStudio`
   generates stills+motion with real generation params. Both need a media/gen seam.
6. **Multi-site / workspace management** — `websites/` + `workspaceId` scoping.
7. **Themes + plugins + i18n + settings + observability/analytics + appearance**
   as pluggable product surfaces (present in both `apps/web/src` and Runner `src`).

### Convergently-shared PATTERNS (Tovu product independently reinvented) [V/I]
Not shared code, but three independent teams landing on the same seam is the
best possible evidence the seam belongs in the engine:
- Ports/adapters with **dual memory+sqlite adapters** per module.
- **`workspaceId` structural scoping** everywhere.
- **Plugin runtime = prebuilt signed ESM + manifest, no plugin DDL.**
- **Declarative themes by default, code themes = trusted mode.**
- **SQLite-first, Postgres-portable** persistence.
- **Outbox/event decoupling + gated-mutations + operation-lock.**
- **capability-inventory** as a machine-checked capability surface.
- **spec-first + test-first** module discipline (`__specs__/` + `__tests__/`).

### OD-only (do NOT assume reusable — only OD needs them today) [V/I]
- OD's specific **design-templates catalogue, design-systems, skills, craft**
  content directories (product content, not engine).
- The **`ChatComposer.tsx` / `ChatPane.tsx` god-components** — explicitly rejected
  by Tovu; keep them app-local, expose a headless runtime instead.
- OD's **packaged-updater / release-channel / installer identity** machinery and
  the `tools-pack` / `tools-dev` / `tools-serve` control planes (Runner just runs
  `node dist/cli.js` + `next dev` directly; it does not use these).
- OD's **sidecar/stamp/namespace** control-plane concepts (not present in Runner).
- Tovu (product) **CMS domain modules** (comments/newsletter/members/forms/seo/
  redirects/navigation) are Tovu-only product, not engine.

---

## 5. Implications for Jini package boundaries & UI architecture

1. **The proven reuse boundary is `apps/web/src` = product; everything below =
   engine.** Jini should make that a *first-class supported seam* (a documented
   "swap the web src, keep daemon+host+packages" mode), because Tovu-Runner
   already relies on it via a filesystem symlink hack. Turning that hack into a
   real config/mount point is the highest-value engine affordance.
2. **Chat must be headless.** Both consumers want the chat *runtime*; neither
   wants OD's monolithic composer. Extract a `@jini/chat-runtime` (protocol +
   hooks + state) separate from any React composer UI. Tovu's plan is CopilotKit/
   AG-UI on top — so the boundary should be UI-framework-agnostic.
3. **`@open-design/*` → `@jini/*` packages are already a de-facto contract.**
   Both consumers resolve them from one `node_modules`. Keep `contracts` pure and
   make the DTO/SSE/error surface the stable ABI (OD's AGENTS.md already says
   this; Tovu-Runner confirms an external consumer depends on it).
4. **Daemon + `od` CLI is the embeddability contract, validated.** Tovu-Runner
   drives the engine purely through `node dist/cli.js` + HTTP. This confirms OD's
   "UI/CLI dual-track" rule empirically — the CLI/daemon is what an external
   product actually binds to.
5. **Media generation (image+video) is a real shared domain**, not OD-incidental.
   Give it an engine seam (generation ports + asset/rendition model).
6. **Do NOT pull CMS domain into the engine.** Tovu proves the content domain
   (posts/comments/newsletter/members) belongs in the *consumer product*, behind
   engine-provided storage/plugin/theme/workspace primitives. Jini's job is the
   agent+chat+media+multi-site+plugin/theme host; the domain is the consumer's.
7. **Runner ≠ cloud project-runner.** If Jini wants a cloud runner with ledgers,
   `AI-Dev-Shop`'s orchestration/memory/reports/governance vocabulary is the
   design reference; the Runner desktop launcher is not.

### Caveats / unverified
- `Tovu-Runner/web/packages/{sdk,server,renderer-react}` are empty scaffolds; the
  workspace-extraction is aspirational, so "Runner uses N shared packages" is
  **not** yet true in code — today it uses `src/` + the engine's `@open-design/*`.
- I did not exhaustively read every Runner `src/` file; media/websites/chat
  characterizations are from headers + directory shape (**[I]** where noted).
- The `Tovu` product repo's giant `:memory:.snapshot-*` files at root are SQLite
  test snapshots (comments/newsletter), not product structure — ignored.
