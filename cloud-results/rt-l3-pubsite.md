PARTIAL a80699eaea 6b3a973c3: pub-members (13 regs), pub-commerce (5), pub-site (23), media leftovers (7 of 12) — all STOP: need a public/admin host-port change or are non-JSON

# RT-K1 lane L3 (public site) — cloud run 2026-11-23

Branches: Tovu `codex/rt-l3-pubsite-tovu`, Jini `codex/rt-l3-pubsite-jini`. Base: `origin/codex/k1-pilot-{tovu,jini}`, with the
**rv1123e fix round merged in during the run** (Tovu `e1d6a58b16`, Jini `3e3b9da91`) and the template's
"Migration for families converted before 582db5967" checklist applied to every family converted here.
Programmer skills read before work: `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5): confirmed.
Started 20:57 UTC, ended about 22:05 UTC. Coordinator plus 6 Opus subagents, at most 3 at a time. Subagents never committed.
There are no other `origin/codex/rt-*` heads. The `ex6-*`/`ex7-*` heads were present; none touch the L3 route dirs,
so nothing was skipped as already converted.

## Per family

| family | routes converted / total | Tovu files deleted | left hand-written |
|---|---|---|---|
| admin seo | **6 / 6** admin (10 module regs; the 4 public xml/txt site routes are pub-site's) | 7 (`routes/seo/*`) | — |
| admin media | **5 / 12** (update, trash, delete, get-providers, put-providers) | 6 (5 routes + `http/media.ts`) | list (sets `Cache-Control` for documents), where-used + import-url (own 403 copy without `details` → port change), text (headers + own 403), upload/replace (multipart/raw), original (bytes/Range) |
| public members | **0 / 13** | 0 | all — see STOP |
| public commerce | **0 / 5** | 0 | all — see STOP |
| public site | **0 / 23** (+ render/sandbox sheets) | 0 | all — see STOP |
| admin assistant | **14 / 15** (settings ×2, visitor-tools ×2, site credential ×3, execution credential ×3, detect-agents, list-models, test-agent, test-connection) | 16 (14 route files' sources + `deps.ts`, `execution-deps.ts`, `resolve-test-agent-outcome.ts`; minus 2 kept) | get-chat-attachment (binary bytes). `stored-credential-probe.ts` stays host-side and is injected as `resolveProbeCredential` |

FILES LEFT (`plans/P9-data/tools/scan.mjs`, non-test `.ts`): L3 dirs **102 → 74** (seo 7→0, media 17→12,
assistant 18→2, pub-members 15, pub-commerce 1, pub-site 44 unchanged); all inbound route files 367 → 339.

## STOP list (owner rules), for decision
1. **Public ports cannot carry these routes (host-port change in `admin-json-route-ports.ts`).** `mountPublicJsonRoute` has
   no `workspace`/`authenticate` port, and a spec cannot read the client IP or headers, or set cookies or headers.
   Every public members/commerce/site route needs at least one of the following:
   - IP rate limiting and `Retry-After` (`checkMemberRequestLimits`/`refuseMemberRequest`);
   - Tovu's comment-post same-origin policy (no-Origin JSON allowed, `TOVU_PUBLIC_URL`, own 403 body), which core
     `requireSameOrigin` does not reproduce;
   - the workspace 404;
   - session/proof cookies;
   - `Cache-Control`/`Referrer-Policy`;
   - 303 redirects;
   - HTML, XML or text bodies, or media bytes;
   - `res.once("finish")` hooks.

   Details per route: members/commerce in the subagent report summary below; site: analytics-ingest (IP, UA, DNT,
   204), comments-submit (IP limiter + origin policy), search (`Cache-Control`), feed/llms/robots/sitemap (xml/txt),
   media-rendition (bytes), member-pages/products/newsletter/chat-comparison/pages (HTML), forms-submit (303 + flash cookie).
   **Unblock**: either extend the public ports (request facts + response headers/cookies + workspace port), or the
   ServerRoute variant. Its only mount today, `mountJiniRoutes`, adds an `app.use` layer and so changes the route-table pin.
2. **Media where-used / import-url**: their 403 bodies (`{error:'media.read is required', code:'FORBIDDEN'}`, no
   `details`; `"not authorized for media.upload"`) differ from the admin authorize port's 403. Port change needed.
3. **Step-sheet drift**: `RT-K1-pub-members-1/2/3/5/6` mark cookie/IP routes as `defineJsonRoute`. The generator did not
   see the cookie, IP and header needs inside the helpers those routes call.

## Tests
- **Jini**: `pnpm -r build`, `pnpm typecheck`, `pnpm guard`, `pnpm api:check` all exit 0. cms `src/admin-http` vitest
  244/244 (42 files). core `src/contracts` 417/417. New spec tests: seo 27, media 18, assistant 61 (incl. `Same<A,B>` wire-DTO parity).
- **Tovu**: `npm run typecheck` exit 0 (base: exit 0). Family + menus/redirects + `admin-json-route-ports` + site xml/txt
  route tests: **642/644**. The 2 red (`seo-site-serving` T045/T045b) are red on the unmodified base too.
- **Route-table pin**: the failure output is identical to base after every family and after the merge (normalised diff = 0 lines;
  base is 7/10 red, `/internal/*` drift).
- **why-comments**: `check-why-comments --base origin/codex/k1-pilot-tovu --merge-base --other-root ../Jini` → ok
  (moved/reworded blocks recorded in `development/why-comments-debt.json`).
- **Mutations** (Jini source, rebuilt, both sides, restored + `cmp`):
  - seo M1: drop SEO_FIELD_VALIDATION rung → Jini 1 red, Tovu 2 red. M2: drop SEO_CONCURRENT_WRITE → Jini 1, Tovu 1.
  - media M1: `update` accepts non-string alt → Jini 1, Tovu 3. M2: delete 409 drops `referencing` → Jini 1, Tovu 2.
  - assistant-exec M1: blank-baseUrl refusal off → Jini 1, Tovu 1. M2: drop `!agent.available` → Jini 1, Tovu 2.
  - assistant-settings M1: non-string apiKey check off → Jini 1, Tovu 2. M2: hard-coded `adminAssistantEnabled` → Jini 1 (after adding the `false` assertion), Tovu 2.
- Tovu wire tests: import lines only. Exceptions, both caller-shape only per the migration checklist:
  - `detect-agents-projection.test.ts`: object-arg calls.
  - `agent-probe-characterization.test.ts`: the child-process module URL string.

## Departures / notes (each deliberate)
- Admin body validation stays in `handle` after `authorize` for seo, media `update` and assistant: the hand-written
  routes answered 403 before 400. No mount needs `deferMissingPrincipal` or `authorizationByPermission`: every route made one authorize call after reading the principal.
- seo put-entry answered its 500 via `adminFailureResponse` (operation only). Its mount pins that operation-derived copy
  (`PUT_ENTRY_FAILURE`), because a plain `failure.operation` would have answered "Save entry". media `update` did the same; its
  failure-matrix tests match with a session present, while a session-less 500 now gets `sendAdminFailure`'s anonymous copy (unpinned).
- Body shapes beyond `rejectRoute` (seo version-conflict `details`, media delete `referencing`) throw `RouteRefusalError` directly.
- Host error classes and copy are injected tables (`saveErrorMappings`, `errorMappings`), so Jini has no `instanceof` on Tovu classes.
- Core DTOs: `contracts/site/cms-{media,seo,assistant}`. seo per-entry `{data: SeoMeta|SeoAnalysis}` is **deferred**:
  Core would have to restate the whole SEO model. Admin client types alias the Core DTOs. `apps/admin` tsc is red in this
  environment (missing React/testing-library types), with an identical error list base vs now.
- Stale comment pointers left in files of other lanes (would conflict): `routes/types.ts:1324`,
  `features/media/read-chat-attachment.ts:61`, `daemon-supervisor.ts:535`, `apps/admin` ai-assistant api comments,
  `comments/{get,put}-settings.ts` doc refs to `routes/seo/*`.
- **wip snapshot commits** (`wip(assistant)…`, `wip(k1-migration)…`) were pushed while subagents ran, per the repo's
  commit-cadence rule. Each one is followed by a reviewed commit; squash at combine if wanted.

## Commits (all pushed, plain `git push`, no force)
Jini `codex/rt-l3-pubsite-jini`: 2c7ec38a5 seo · 6b2013663 media · 66fb80586, 15d8318f0 wip · b39c7af07 assistant ·
3e3b9da91 merge k1-pilot-jini (rv1123e) · 35c2dc39f wip · 6b3a973c3 Core DTOs + object args. Plus the report-copy commit.
Tovu `codex/rt-l3-pubsite-tovu`: 15f5d9908d seo · 52319a699f why · b959d86720 media · 8eba9defae why · 71cf41e43b,
9f49c3bc0d wip · 6bdeaaff1d assistant · e1d6a58b16 merge k1-pilot-tovu (rv1123e) · 6b1d82c563 wip · a80699eaea migration. Plus this report.
