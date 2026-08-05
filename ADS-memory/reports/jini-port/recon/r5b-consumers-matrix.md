# R5b — 4-consumer capability matrix (read-only)

Consumers of the extracted engine ("Jini" = the open-design engine):
1. **OD** — Open Design, the design tool (our `open-design` checkout / engine baseline).
2. **Open-Marketing (OM)** — `/Open-Marketing`, "Open Design for marketing".
3. **Tovu-Runner** — `/Tovu-Runner`, desktop operator host (from R5).
4. **Zana** — `/Zana`, "bolt/lovable/replit on the desktop" (code-gen + live preview).

Legend: **[V]** verified from a file · **[I]** inferred. Consumption model matters
as much as feature list, so it leads each profile.

---

## 1. What each new consumer IS

### Open-Marketing (OM) — a FULL FORK of the OD engine, marketing-tilted
**[V** `package.json`**]** name `open-marketing` **v0.12.1** (ahead of the OD
checkout's 0.10.x), `packageManager pnpm@10.33.2`, description: *"Local-first
marketing workspace: detects installed code-agent CLIs, drafts campaign work, and
keeps design templates and brand systems available for creative production."*
- **Stack:** identical to OD. `apps/{daemon,web,desktop,packaged,landing-page,
  telemetry-worker}` **[V]**. Web is `@open-design/web` on **Next 16 + turbopack**
  (dev), with a **Vite alternative path** (`dev:vite`, `OD_WEB_DEV_SERVER=vite`,
  `tools/dev-vite.ts` spawns daemon :5288 + vite :5274) **[V]**. Node ~24, `od`+`om`
  bins **[V** `bin`**]**.
- **Consumption model = whole-monorepo FORK, not a src-swap.** It ships its OWN
  copy of the engine packages: `packages/{contracts,components,host,platform,
  sidecar,sidecar-proto,plugin-runtime,agui-adapter,download,release,diagnostics,
  metatool,registry-protocol,launcher-proto}` and depends on `@open-design/*`
  `workspace:*` **[V** grep found 27 `@open-design/*` refs**]**. It also keeps OD's
  content dirs: `design-systems/ skills/ design-templates/ craft/ plugins/
  figma-plugin/ mocks/ story/` **[V]**. So OM ≈ OD engine + marketing product
  layer; it is the strongest evidence the engine can be product-neutral.
- **Marketing/divergent surfaces vs OD [V]:** `agui-adapter` (AG-UI/CopilotKit),
  `telemetry-worker`, `apps/landing-page`, `clipper/` (MV3 browser web-clipper into
  the Library), `deploy/` (Dockerfile + docker-compose + aws/ + azure/ self-host),
  `metatool`. Web deps add `@copilotkit/react-core`, `@lexical/*` (rich text),
  `@xterm/xterm` (**terminal**), `jspdf`, `@anthropic-ai/sdk`, `openai` **[V]**.
- **Product-neutrality is already enforced [V** `scripts/product-neutrality.test.ts`,
  `guard`**]:** guard rejects named-orchestrator/product copy on public surfaces
  (`packages/contracts`, `apps/web/app/page.tsx`). This is the live mechanism that
  keeps the engine from re-acquiring an OD (or OM) tilt — directly relevant to Jini.

### Zana — INDEPENDENT lovable/bolt/replit desktop clone (code-gen + live preview)
**[V** `open_source_lovable_bolt_replit_copy.md`, `app-chassis/README.md`, `TODO.md`**]**
- **No root package.json / README** (it is a research workspace). The buildable
  thing is **`app-chassis/`** = a fresh pnpm monorepo, name `app-chassis`,
  `@chassis/*`, `pnpm@9`. **It does NOT reference `@open-design/*` at all** **[V**
  grep empty**]** — fully independent, built by *studying* OD/payload/directus/
  wordpress/open-webui/dify as reference repos (`open-design-learnings.md`) **[V**
  TODO.md**]**.
- **Stack [V** `app-chassis`**]:** `apps/{daemon,web(Next, SSR/SEO),studio(Vite
  builder UI),desktop(Electron)}`; `packages/{core,ai,db,auth,storage,payments,
  plugins,themes,ui,admin,cli,templates}`; `providers/supabase`. Daemon boots on
  :4000, `GET /capabilities`. Most packages are stubs; built slice = core+db+ai+daemon.
- **Architecture thesis [V** README "Core principles"**]:** "Rigid core, flexible
  edges." **Capability ports + providers** (`db/auth/storage/realtime/llm/payments`;
  a provider declares which capabilities it implements — `sqlite`→`db`, Supabase→
  `db+auth+storage+realtime`). **`actions.ts` in every package** registers
  AI-callable tools so chat drives everything. **`ToolRegistry` with only
  `search_tools`+`call_tool` meta-tools** (avoid tool overload). **MCP/AG-UI/A2A are
  transport adapters, never core.** This is remarkably close to OD's own trajectory
  (tools.ts registry, web-MCP) but re-derived independently → high-confidence seam.
- **Zana's distinctive need vs OD [V** vision md §10, lines 78-81, 501-522**]:**
  **live preview + dev server + sandbox/container/WebContainer runtime + terminal/
  shell + secure code execution** (E2B, Daytona, Docker, Firecracker microVMs,
  StackBlitz WebContainers, Sandpack). This is the row OD does NOT have (OD only
  does *static* sandboxed-iframe artifact preview) — see §3.

### OSS-Marketing-Repos — NOT a consumer, reference material only
`/OSS-Marketing-Repos` **[V** ls**]** is a library of upstream OSS marketing tools
(chatwoot, dittofeed, formbricks, inngest, jitsu, listmonk, matomo, novu, posthog,
rudder-server, trigger.dev, unomi). It is domain *reference* Open-Marketing mines
for its marketing capabilities (analytics, email/newsletter, CDP, event pipelines,
workflow/cron) — not an engine consumer. Note `trigger.dev`/`inngest` are durable
job-runner references relevant to the Jini project-runner (§4).

---

## 2. THE 4-CONSUMER CAPABILITY MATRIX (key deliverable)

Marks: **C** = present as engine-level capability · **P** = present but product-
specific content/domain · **A** = needs an adapter/port not yet in OD · **—** = absent.
"Engine core?" = shared by ALL 4 (or by 3 with the 4th plausibly).

| Capability | OD | OM | Tovu-Runner | Zana | Engine core? |
|---|---|---|---|---|---|
| **Daemon HTTP API** (`/api/*`) | C | C (fork) | C (reuses OD daemon) | C (`@chassis/daemon` :4000) | **CORE — all 4** |
| **CLI binary** (`od`/`om`, embeddability) | C | C (`om`+`od`) | C (runs engine `cli.js`) | C (`packages/cli`, `/capabilities`) | **CORE — all 4** |
| **Headless chat runtime** | C (but monolith ChatComposer) | C (+`agui-adapter`/CopilotKit) | C (CopilotKit rebuild, rejects ChatComposer) | C (chat drives `actions.ts`) | **CORE — all 4 (all trending headless/AG-UI)** |
| **Agent runtimes** (spawn CLI agents, BYOK) | C (21 CLIs, AMR) | C (detects code-agent CLIs) | C (via engine) | C (LLM gateway + agent loop) | **CORE — all 4** |
| **Tool registry** (`search_tools`/`call_tool` + per-domain actions) | C (tools.ts registry, web-MCP) | C (fork) | ~ (via engine) | C (central thesis) | **CORE — convergent** |
| **Sandboxed artifact / preview render** (iframe, HTML/PDF/PPTX/MP4) | C | C (fork) | C (media/websites preview) | C (live preview central) | **CORE — all 4** |
| **Multi-project / workspace** (`workspaceId`) | C (projects) | C | C (websites, workspaceId) | C (desktop manages many projects) | **CORE — all 4** |
| **Themes / appearance** | C (≈design systems) | C | C (`themes/`,`appearance/`) | C (`packages/themes`) | **CORE — all 4** |
| **Plugin runtime** (signed ESM + manifest) | C (261 plugins) | C (`plugin-runtime`) | C (`plugins/`) | C (`packages/plugins`) | **CORE — all 4** |
| **Settings** | C | C | C (`settings/`) | C | **CORE — all 4** |
| **i18n** | C (18 locales) | C (`i18n:check`) | C (`i18n/`) | ? (unseen) | core-likely (3/4) |
| **Observability / telemetry** | C | C (`telemetry-worker`) | C (`observability/`) | ? | core-likely (3/4) |
| **Media gen — image** | C (14 providers) | C | C (MediaStudio stills) | — | shared-3 (design lineage), engine port |
| **Media gen — video** | C (HyperFrames/MP4) | C | C (MediaStudio motion) | — | shared-3, engine port (NOT universal) |
| **Design-systems** (`DESIGN.md` brand contracts) | P (150) | P (fork) | — (uses themes, not DESIGN.md) | — | **PRODUCT (OD/OM only) — classic OD tilt** |
| **Brands** | P | P | — | — | PRODUCT (OD/OM) |
| **Figma** (`figma-plugin`) | P | P | — | — | PRODUCT (OD/OM) |
| **Code-gen + live dev-server + sandboxed EXEC** | — (static preview only) | — | — | **A (core need)** | **ZANA-ONLY → must become engine port (§3)** |
| **Terminal / PTY** (xterm) | ~ | C (`@xterm` in web) | — | A (shell panel) | shared-2 → engine port |
| **Capability-provider model** (auth/storage/payments/db swappable) | thin | thin | C (ports+sqlite/memory) | C (ports+Supabase) | **CORE-convergent (Tovu+Zana explicit) → engine port** |
| **Marketing domain** (campaigns, CDP, email, deploy/self-host) | — | P (only) | — | — | PRODUCT (OM adapter) |
| **CMS / website ops** (posts/comments/newsletter/members) | — | ~ | P (hosts Tovu product) | ~ (member-directory app) | PRODUCT (Tovu adapter) |
| **Project-runner / cloud agent work + ledgers** | — | — | — | — | future engine capability; prototyped by AI-Dev-Shop (§4) |

**Confirmed engine CORE (shared by all 4):** daemon HTTP API · CLI · headless
chat runtime · agent runtimes · tool registry (search/call + actions) · sandboxed
preview render · multi-project/workspace (`workspaceId`) · themes · plugin runtime ·
settings. **Core-likely (3/4):** i18n, observability, capability-provider ports.

**Product adapters (NOT engine):** design-systems/brands/figma (OD+OM) · media
gen image/video (design-lineage 3, absent in Zana) · marketing/deploy (OM) ·
CMS/website (Tovu) · code-gen/live-exec (Zana).

---

## 3. What Zana / OM need that OD does NOT — must be first-class engine ports

Designing to OD alone would miss these; all are load-bearing for a non-OD-tilt engine:

1. **Sandboxed code execution + live dev-server preview (Zana, load-bearing).**
   OD's preview is a *static* sandboxed iframe of a finished artifact. Zana needs a
   **running project**: file-write loop → dev server (Vite/Next) → hot-reload → live
   iframe, plus a **secure exec sandbox** (E2B / Daytona / Docker / Firecracker /
   WebContainer). Jini needs a **"workspace runtime / sandbox-exec port"** with a
   preview-URL contract — orthogonal to the artifact renderer. **[V** vision §10**]**
2. **Terminal / PTY port (Zana + OM).** OM's web already bundles `@xterm/xterm`;
   Zana wants a shell panel. A generic PTY/terminal stream belongs in the engine,
   not a product. **[V]**
3. **Capability-provider registry with auth / storage / payments / db / realtime
   (Zana + Tovu, convergent).** OD models these thinly; Zana and Tovu both built an
   explicit port+provider layer (Supabase, sqlite/memory). This should be an engine
   primitive (`ports.ts` + provider registry declaring capabilities), so products
   swap Supabase/SQLite/Stripe without touching core. **[V** both READMEs**]**
4. **Self-host / deploy target (OM).** OM ships `deploy/` (Docker/AWS/Azure). A
   headless server-deploy path (not just a desktop app) should be an engine mode.
5. **AG-UI / CopilotKit as the blessed chat transport.** OM (`agui-adapter`),
   Tovu-Runner (CopilotKit rebuild), and Zana (AG-UI adapter) independently chose
   AG-UI/CopilotKit over OD's ChatComposer — the engine's chat seam should target
   this, and OD's monolithic composer should NOT be the reusable artifact.

---

## 4. Is AI-Dev-Shop the right prototype for the Jini project-runner? (one paragraph)

`AI-Dev-Shop` is dropped into **three** of the four repos (Open-Marketing,
Tovu-Runner, Zana each vendor their own `AI-Dev-Shop/`) **[V]**, which makes it the
de-facto shared orchestration substrate across the family — a strong vote of
confidence. As a *design prototype* for the runner it is right: it already models a
**staged multi-agent pipeline** (analyzer→spec→red-team→architect→TDD→programmer→
QA→review→security→docs), with `framework/{memory, reports, routing, governance,
workflows}` and `harness-engineering/{agent-evals, harness-evals, hooks, policy}` —
i.e. exactly the **stage model + memory/ledger + governance-gate + routing
vocabulary** a Jini `project-runner` (cloud agent work + ledgers) needs. BUT it is a
**prompt/agent-instruction framework dropped into a repo**, not a runnable control
plane: no durable queue, no sandbox pool, no persisted run-ledger service, no
concurrency/retry engine. So use AI-Dev-Shop as the **conceptual/vocabulary blueprint**
for the runner's pipeline and ledger schema, but the actual runtime should be a real
service (durable job queue + sandbox-exec pool + artifact/run ledger) — the OSS
references already sitting in `/OSS-Marketing-Repos` (`trigger.dev`, `inngest`) are the
better shape for that execution substrate. Net: AI-Dev-Shop = the *what/stages*;
trigger.dev/inngest-style durable runner = the *how/runtime*.

---

## Caveats / unverified
- Zana's `app-chassis` is an early prototype (most `packages/*` and `apps/{web,
  studio,desktop}` are stubs per its README); its capability marks reflect stated
  architecture + built core slice, not a finished product.
- OM is a living fork ahead of the OD checkout; a few OM-only packages
  (`agui-adapter`, `metatool`, `telemetry-worker`) may or may not exist in the OD
  checkout — treat them as engine candidates OM has already pulled forward.
- i18n/observability marks for Zana are unverified (dirs not seen) — listed 3/4.
- Media image/video for Zana marked absent from its vision; not exhaustively ruled out.
