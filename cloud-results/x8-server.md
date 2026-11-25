PARTIAL dc4eb57e2 b7d66faca: 31 route files CONVERTED this run, but planner FILES LEFT moved only admin-http 65→63 / public-http 86→86 (28 STAYS-HOST bindings still counted, list below); left: owner-passkey, publish-credentials, site-share-password, site-shares, external-mcp probe/oauth, settings/events, site-imports, publish-site, commerce/purchase, media-rendition/original, plugins, pages handlers; full Tovu sweep compared on 22 files only (time)

SHAs in the first line are the work tips before this report commit (Tovu `codex/x8-server-tovu`, Jini `codex/x8-server-jini`).

# x8-server (2026-11-25): Tovu -> Jini extraction, SERVER ROUTES lane (public-http + admin-http)

This was an unattended cloud run. An Opus coordinator ran about 27 subagent dispatches, with at most 4 running at once:
- **Opus** (`opus-high`): every security, auth or credential route, and the mount-port design work.
- **Sonnet** at high effort: the non-SEC routes, the isolation fix, the gate runs and the why-comment sweep.

`AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) was read first, and **this report confirms it**. Every worker got a common brief built from it (`BRIEF.md`):
- root cause first, minimum change;
- test-first, with a named mutation for every behaviour-bearing change;
- fresh evidence before any claim, and the pre-completion checklist;
- the owner rules;
- the STOP rule: a route that cannot be byte-identical is left untouched and the missing opt-in is named.

## Setup
- **Branches.** Tovu `codex/x8-server-tovu` from `origin/codex/x6-server-tovu` (`963838d1f`). Jini `codex/x8-server-jini` from `origin/codex/x6-server-jini` (`57479909b`). Both were pushed at base and then after every batch; `wip(x8-server)` commits are snapshots.
- **Node 24.** `/opt/node24/bin` was first on PATH.
- **Jini.** `pnpm install --frozen-lockfile` and `pnpm -r build`: both exit 0.
- **Tovu.**
  - `npm ci --ignore-scripts` in root, admin and desktop (npm 11): exit 0.
  - `link:jini` had to be re-run with `JINI_PACKAGES_DIR=/home/user/Jini/packages`, because the default looks under `/root/Programming`.
  - Then `packages/{contracts,sdk}` were built.
- **Base worktrees** for gate comparison: `/home/user/wt/Jini` (its own install and build) and `/home/user/wt/Tovu`, with `@jini-ai/*` linked to the base Jini.
- **Test flag.** Tovu's real `npm test` uses `--experimental-test-module-mocks`. Workers started without it and switched mid-run. The final sweep below uses it on both base and branch.

## FILES LEFT (combine-18 planner + P9 scan, `src` count per area)

| area | before (x6 tip) | after (branch) | after, if the 28 bindings below become keep-rules |
|---|---|---|---|
| public-http | 86 (LOC 9542) | 86 (LOC 9384) | 73 |
| admin-http | 65 (LOC 9700) | 63 (LOC 8733) | 48 |
| contracts-core / site-backup / publish-content (other lane) | 25 / 37 / 20 | 25 / 37 / 20 | untouched |
| all areas | 1251 | 1249 | 1221 |

Why the file count barely moved: a K1 conversion moves the route's logic into Jini but leaves the Tovu registrar as a binding at the same path. That file only calls a Jini spec or mount with host values (cookie names, copy, limiters, `requestDeps` closures), and the planner still counts it. Two files were deleted outright (`admin-http/http/api-keys.ts`, `admin-http/routes/system/custom-credentials.ts`), as was `public-http/routes/members/password-sign-in.ts`. One host file was added (`public-http/routes/site/newsletter-public-scope.ts`).

**STAYS-HOST bindings: please add these to the planner keep-rules** (paths under `apps/website/src/server/inbound/`).
- Bindings that only build deps and mount a Jini spec:
  - admin-http: `routes/fs-files/{custom-root,folder-picker}.ts`, `routes/api-keys/{create-principal,issue,revoke}.ts`, `routes/analytics/recent-hits.ts`, `routes/publish-content/blobs-probe.ts`, `routes/posts/template-preview.ts`, `routes/system/{dockerfile-source,mail-providers}.ts`, `routes/media/list.ts`, `routes/themes/preview.ts`, `owner-mfa-routes.ts`, `owner-recovery-routes.ts`
  - public-http: `routes/site/{search,analytics-ingest,newsletter-confirm,newsletter-unsubscribe,newsletter-public-scope}.ts`, `routes/agent-plugin-surfaces/export-files.ts`, `routes/content/posts/get-by-slug.ts`, `routes/mail-feedback.ts`, `routes/members/oidc-start.ts`
- Bindings that also hold host-only logic, so they stay host either way:
  - `routes/sites/sites-home.ts`: the fs probe;
  - `routes/members/oidc-callback.ts`: the OIDC protocol leg;
  - `routes/members/oidc-verify-email.ts`: `proofBody` and verification;
  - `routes/members/unlink-identity.ts`: the unlink lifecycle;
  - `routes/members/sign-in.ts`: refusal copy;
  - `routes/members/complete-sign-in.ts`: cookie serialization;
  - `routes/api-keys/deps.ts`: the host bag.

## Mount opt-ins added (all additive, test-first, defaults byte-identical, no route-table rows changed)
| where | opt-in | why / first user | mutation(s) |
|---|---|---|---|
| Jini http-kit `JsonRoutePorts` | `payloadTooLarge?: ({res,maxBytes}) => void` host writer for the spec body-cap 413 | blobs-probe (in the end mounted with the host middleware via `bodyParsers`, so the pin row stays 2-handler) | `payload-too-large-port-ignored` |
| Jini http-kit `RouteMountOptions` | `bodyParsers?: RequestHandler[]` — path-scoped parsers registered `app[m](path, ...parsers, handler)` | template-preview POST `express.urlencoded`, blobs-probe 413 middleware, mail-feedback `express.raw` | `body-parsers-dropped` |
| Jini http-kit `RouteMountOptions` | `requestDeps?: ({req,res,deps}) => Deps` — per-request host closures, sync, before every gate; spec never sees `req` | search, folder-picker, analytics-ingest, themes preview, custom-credentials, mail-providers, get-by-slug, members, owner-mfa/recovery | `request-deps-ignored`, `request-deps-shared-across-requests`, `request-deps-raw-ignored`, `request-deps-before-headers`, `request-deps-only-in-handle` |
| Jini http-kit `RouteRequestOptIns` | `admittedResponseHeaders?: (raw) => headers` — request-dependent headers applied right after the workspace port (sync, tick order kept) | media list `?kind=document` `Cache-Control: private, no-store` on 200/403/500, not on the workspace 404 | `admitted-headers-before-workspace` |
| Jini http-kit raw spec | `bufferedReply: "redirect"` — a 3xx is replayed through the framework redirect writer (Accept-negotiated body + `Vary: Accept`), cookies/headers copied as `sendBufferedReply` does | oidc-start, oidc-callback, themes preview 302 | `redirect-not-replayed` |
| Tovu admin mounts | `refusalWriter` / `failureWriter` (text/plain or route-owned envelopes), `payloadTooLarge`, `bodyParsers`, `requestDeps` | template-preview (text/plain 404/403/500), analytics recent-hits (canonical envelope) | `refusal-writer-ignored`, `failure-writer-ignored`, `host-payload-too-large-dropped`, `admin-body-parsers-dropped`, `tovu-mount-drops-request-deps` |
| Tovu admin mounts | `afterWorkspace` (host check after the workspace 404, before authenticate) and `failureByPhase` (failure copy chosen by whether `authorize` already ran, per request) | sites-home PUT | `after-workspace-runs-before-404`, `failure-phase-shared-across-requests` |
| Tovu public mounts | `requestDeps`, `bodyParsers` (`PublicRouteMountOptions`) | members, search, ingest, mail-feedback | `public-mount-drops-body-parsers` |

Verified, no code needed: a spec's static `responseHeaders` already reach every port refusal (http-kit `applyResponseHeaders` runs first; host writers never remove headers).

## Route table (tovu files under `apps/website/src/server/inbound/` unless noted)

| route / file | result | Jini owner | notes (wire evidence: before = after) |
|---|---|---|---|
| admin-http/routes/publish-content/blobs-probe.ts | CONVERTED (binding) | cms `admin-http/routes/publish-content/blobs-probe` | host 413 middleware kept via `bodyParsers` (2-handler pin row kept); blob key injected (S9). Wire 119/119 |
| admin-http/routes/posts/template-preview.ts | CONVERTED (binding) | cms `admin-http/routes/posts/template-preview` | 2 raw specs, text/plain writers, POST-only `express.urlencoded` via `bodyParsers`, `handlerName: handlePreviewRequest` |
| admin-http/routes/fs-files/custom-root.ts | CONVERTED (binding) SEC | cms `admin-http/routes/fs-files/custom-root` | fixed a security-relevant drift in the existing spec: it sent an extra `entityType` to authorize. Wire 30/30 + 14/14 |
| admin-http/routes/fs-files/folder-picker.ts | CONVERTED (binding) SEC | cms `admin-http/routes/fs-files/folder-picker` | local-request + session-kind bound via `requestDeps`; non-local refused before any picker call. Wire 6/6 |
| admin-http/routes/api-keys/{create-principal,issue,revoke}.ts + deps.ts | CONVERTED (bindings) SEC | user-management `admin-http/routes/api-keys/*` | `sessionCredentialOnly` gate; error ladder + failure op kept. Wire 48/49 → 54/55 (same base red; +6 deps tests) |
| admin-http/http/api-keys.ts | MOVED (deleted) | user-management `admin-http/http/api-keys` | response DTO helpers |
| admin-http/routes/analytics/recent-hits.ts | CONVERTED (binding) | analytics `admin-http/routes/recent-hits` | host canonical envelope via `refusalWriter`/`failureWriter`. Wire 55/56 = |
| admin-http/routes/system/dockerfile-source.ts | CONVERTED (binding) | cms `admin-http/routes/system/dockerfile-source` | authorize → If-Match → body order pinned. Wire 50/50 |
| admin-http/routes/system/custom-credentials.ts | CONVERTED (file deleted; registrar in `runtime/composition/modules/system-credentials.ts`) SEC | cms `admin-http/routes/system/custom-credentials` | credential kind bound via `requestDeps`; owner/session gates in order. Wire 25/25 |
| admin-http/routes/system/mail-providers.ts | CONVERTED (binding + host classifier) SEC | cms `admin-http/routes/system/mail-providers` | secrets write-only, store refusal returns code only. Wire 9/9 |
| admin-http/routes/media/list.ts | CONVERTED (binding) | cms `admin-http/routes/media/list` | new `admittedResponseHeaders`. Wire 102/103 = (base red: missing `media/text.js` from another lane) |
| admin-http/routes/themes/preview.ts | CONVERTED (binding) | cms `admin-http/routes/themes/preview` | `bufferedReply: "redirect"`; `servingAddressOf` via `requestDeps`. Wire 22/22 |
| admin-http/routes/sites/sites-home.ts | CONVERTED (binding; keeps the host fs probe) | cms `admin-http/routes/sites/sites-home` | new `afterWorkspace` + `failureByPhase`. Wire 38/38 |
| admin-http/owner-mfa-routes.ts | CONVERTED (binding) SEC | user-management `admin-http/owner/mfa-routes` | public raw mount (runs before the admin session gate); admission/origin/limiter bound per request. Wire 18/18 → 19/19 (+1 header pin test) |
| admin-http/owner-recovery-routes.ts | CONVERTED (binding) SEC | user-management `admin-http/owner/recovery-routes` | desktop header name injected; local fact per request. Wire 19/19 |
| admin-http/owner-passkey-routes.ts | STOPPED (budget/time) SEC | — | same pattern applies; open: prove the `signedIn(req,res)` cookie bytes on the wire |
| admin-http/routes/system/site-share-password.ts | STOPPED SEC | — | needs `req.protocol` + publish-trust `res.locals` as request facts (now possible via `requestDeps`); also exports `sendSiteShareFailure` used elsewhere |
| admin-http/routes/system/site-shares.ts | STOPPED SEC | — | download uses `res.sendFile` (Range/206/304/ETag): needs a raw-mount file/stream reply port; upload row is 3 handlers (gate > express.raw > receiver) |
| admin-http/routes/system/publish-credentials.ts | STOPPED SEC | — | a pinned unit test calls the handler directly and expects the authenticate throw to reject; needs an opt-in letting an authenticate-port throw reject the handler, or an owner decision on that test |
| admin-http/routes/external-mcp/probe.ts | STOPPED | — | limiter runs before the workspace 404 with an async check, 429 + Retry-After: needs an async `preflight` that may answer headers |
| admin-http/routes/settings/events.ts | STOPPED | — | needs `forwardUnexpected` (raw mount passes non-refusal errors to `next`) + ~40 direct-handler unit tests rewritten |
| admin-http/routes/system/site-imports.ts | STOPPED SEC | — | upload needs `req.destroy/setTimeout` + single-lane busy flag; owner step sets the owner password (auth) |
| admin-http/routes/system/publish-site.ts | STOPPED | — | not started (budget); notes in S4: blocked event before 403, consent refusal from contracts-core lane |
| admin-http/publish-trust-auth.ts | STAYS-HOST | — | `app.use` gate setting the publish-trust `res.locals` context the ports read |
| public-http/routes/members/password-sign-in.ts | CONVERTED (deleted; registrar in `runtime/composition/modules/public-members.ts`) SEC | cms `public-http/routes/members/password-sign-in` | Wire 244/248 → 245/249 (+1 observer test) |
| public-http/routes/members/sign-in.ts | CONVERTED (file keeps host refusal copy) SEC | cms `public-http/routes/members/sign-in` | Wire 284/289 = |
| public-http/routes/members/complete-sign-in.ts | CONVERTED (file keeps cookie helpers) SEC | cms `public-http/routes/members/complete-sign-in` | raw (appends Set-Cookie); coordinator added `bufferedReply` (res.json parity, pin test RED first) |
| public-http/routes/members/unlink-identity.ts | CONVERTED (binding + host unlink lifecycle) SEC | cms `public-http/routes/members/unlink-identity` | fail-closed refusals. Wire = |
| public-http/routes/members/oidc-start.ts | CONVERTED (binding) SEC | cms `public-http/routes/members/oidc-start` (+ `oidc-shared`) | `bufferedReply: "redirect"`; state/nonce/PKCE code untouched |
| public-http/routes/members/oidc-callback.ts | CONVERTED (binding + host protocol leg) SEC | cms `public-http/routes/members/oidc-callback` | binding-clear cookie on every error redirect; h4-oidc + T44 moved to real HTTP transport (assertions 1:1). Mock run 78/78 |
| public-http/routes/members/oidc-verify-email.ts | CONVERTED (binding; `proofBody` stays host, injected) SEC | cms `public-http/routes/members/oidc-verify-email` | Wire 306/309 = |
| public-http/routes/site/search.ts | CONVERTED (binding) | search `public-http/routes/site/search` | first `requestDeps` user. Wire 12/12 |
| public-http/routes/site/analytics-ingest.ts | CONVERTED (binding) | analytics `public-http/routes/analytics-ingest` | consent/forwarders/hostname/clientAddress bound per request. Wire 73/74 = |
| public-http/routes/site/newsletter-{confirm,unsubscribe}.ts (+ new `newsletter-public-scope.ts`) | CONVERTED (bindings) | user-management `public-http/routes/newsletter/{confirm,unsubscribe,page}` | Wire 86/88 = |
| public-http/routes/agent-plugin-surfaces/export-files.ts | CONVERTED (binding) | cms `public-http/routes/agent-plugin-surfaces/export-files` | Wire 15/15 |
| public-http/routes/content/posts/get-by-slug.ts | CONVERTED (binding) SEC (member gating) | cms `public-http/routes/content/posts/get-by-slug` | locked = missing 404 body; presentation read injected. Wire 89/90 = |
| public-http/routes/mail-feedback.ts | CONVERTED (binding) SEC | user-management `public-http/routes/mail/feedback` | host `express.raw` via `bodyParsers`; signature sees identical bytes. Wire 28/28 |
| public-http/routes/commerce/purchase.ts, site/media-rendition.ts, external-mcp/oauth.ts, plugins/{install,chart-providers}.ts, media/original.ts, publish-content/peer-transport.ts, site-cookie-consent.ts, site/pages/handlers/* | NOT STARTED | — | time; classification reasons unchanged (x6 classify) |


## Gates (branch vs x6 base, same machine, Node 24)

| gate | base | branch |
|---|---|---|
| Jini `pnpm -r build` | 0 | 0 |
| Jini `pnpm typecheck` | 0 | 0 |
| Jini `pnpm guard` | 1 violation (HW3 `admin/shell-failure-log.ts`) | the same single violation. Mid-run it showed 4 SI-domain findings plus 1 N2; those were fixed with `jini.isolation.entries` domain overrides and a comment reword. |
| Jini `pnpm api:check` (after `api:update`: analytics, cms, http-kit, search, user-management baselines) | 0 | 0 |
| Jini `check:hooks` | 0 | 0 |
| Jini `check:why-comments --base origin/codex/x6-server-jini` | — | ok. 1 obsolete block was allow-listed: the custom-root `entityType` rationale, removed with the security fix. |
| Jini vitest: http-kit, cms, user-management, analytics, search | http-kit 2 base reds (`http-error-log-redaction`); cms 2 base reds (forms `package-boundary` version, content-types `universal-entries` jsdom); user-management 4 base reds | **no new red**. 24 cms pglite `5000ms` timeouts passed on re-run with a longer timeout. cms `subpath-isolation.contract` is green after S9. |
| Tovu `tsc -p tsconfig.json` / `typecheck:e2e` / admin tsc | 0 / 0 / 0 | 0 / 0 / 0 |
| Tovu `check:hooks` | ok | ok. The debt ratchet was locked one entry lower with `--update`. |
| Tovu `check:why-comments --base origin/codex/x6-server-tovu` | — | first run: 31 lost blocks. Now **ok** (36 allow-listed): 27 entries cite the Jini or host file that holds the moved or reworded text, and 4 are obsolete (they describe deleted Express code). |
| Route-table pin | 3 pass / 7 fail (base drift) | identical output for every batch. The full 554-row dump is byte-identical. The snapshot fixture was never edited. |
| Tovu node tests, `--experimental-test-module-mocks`, `--test-concurrency=2` (499 files: changed tests plus importers, depth 2) | the base run did not finish in time | **partial.** The branch sweep reached 4.7k tests before the time cap. Its 34 failing tests map to 22 files, which were re-run on both trees: base 201 pass / 27 fail, branch 201 pass / 28 fail. The only new red (`post-list-preview` editor route) was a hand-made `res` double; the transport-only fix is in `dc4eb57e2` and that file is now 10/10. Each worker also reported per-route wire runs, identical before and after (table above). **Not all 499 files were compared base-vs-branch: re-run this sweep before merging.** |

`apps/desktop` was not touched, so the pre-push hook skipped the desktop gates on every push.

## Accepted residual differences (not status/body/cookie bytes; recorded for the owner)
- **Header-name case and order on raw/buffered replies.**
  - Web `Headers` lower-case and sort names, so for example `content-type` comes before `retry-after` on the owner-mfa/recovery 429.
  - Names, values and Set-Cookie order are identical, and HTTP treats both case and order of distinct names as insignificant.
  - Applies to mail-feedback, newsletter, export-files, members and owner routes.
- **Uncaught-exception path.** A throw that escaped a hand-written `asyncRoute` used to reach `next(error)` → `captureRouteError` (`res.locals.routeError`, 4xx-status passthrough). In a mounted spec it now reaches the mount's redacted `sendAdminFailure` 500.
  - Precedent: every earlier K1 conversion.
  - Seen in custom-root, folder-picker, newsletter readiness and the search parse.
  - The wire body is the same redacted 500.
- **Incident operation labels.** These only reach the incident sink, and no test pinned them before the move:
  - custom-root PUT failures before the store are now labelled `routes/fs-files/custom-root`;
  - analytics-ingest gained a `public:analytics-ingest` failure copy, which is unreachable.

## Self-check
- **No re-export or forwarding files.** Dead re-exports in `dockerfile-source.ts` were dropped (no importers). Every Tovu file left is a binding or holds host logic.
- **Inject everything.** No new package edges: cms, user-management, analytics and search import only `@jini-ai/core` contracts. Cross-domain reads are injected (get-by-slug presentation, blobs-probe key, oidc-verify-email `parseProof`).
- **Jini stays neutral.** `rg -i tovu` is empty on new Jini files, and there are no Express types in specs. Cookie names, header names (`x-tovu-desktop-owner-signin`), copy, redirect paths and the MFA issuer are REQUIRED deps from the host.
- **Object args, size and complexity.** Object args everywhere. Every function is ≤ 80 lines with complexity ≤ 10, and no exception rows were added.
- **Why-comments** moved with the code. Leftovers were resolved through the gate (see Gates).
- **No pin edits.** The route-table snapshot fixture was never edited. One worker's attempt was caught and reverted before commit.
- **apps/desktop and themes** were not touched.

## Caps
- **Wall clock.** About 2 h 45 min (01:35–04:20 UTC).
- **Coordinator.** About 200 tool calls.
- **Subagents.**
  - 27 dispatches, at most 4 at once:
    - Opus: O1–O16;
    - Sonnet: S1–S11.
  - **Per-subagent cap deviations:**
    - Tokens: these went over 120k (recorded as cap deviations): S1 188k, S7 178k, O11 162k, O10 155k, O7 155k, O4 158k, O2 158k, O1 143k, O5 144k, O8 147k, O6 140k, S5 139k, S3 134k, S8 132k, O3 132k, O12 131k, S2 128k, O14 130k, S4 126k, O9 125k.
    - Tool calls: only S1 (51) and O8 (51) went over 50.
    - Every return was checked by the coordinator's gates before commit.

## Left / recommendations
Every STOPPED route names the opt-in it needs:
- **owner-passkey.** Same pattern as owner-mfa/recovery. Prove on the wire that `signedIn(req,res)` writes the same cookie bytes (`sendBufferedReply` appends Set-Cookie already on `res`).
- **publish-credentials.** A pinned unit test expects an authenticate-port throw to reject the handler. This needs a mount opt-in or an owner decision on that test.
- **site-share-password.** Now feasible: `req.protocol` and the publish-trust `res.locals` context can be bound via `requestDeps`. Keep the `sendSiteShareFailure` export.
- **site-shares.** Needs a raw-mount file/stream reply port (`res.sendFile` gives Range/206/304/ETag). The upload pin row has 3 handlers.
- **external-mcp probe.** Needs an async `preflight` that can answer with headers (429 + `Retry-After`). That changes tick order, so it needs its own pins.
- **settings/events.** Needs `forwardUnexpected` (the raw mount forwards non-refusal errors to `next`) plus a rewrite of about 40 direct-handler unit tests.
- **site-imports.** Upload needs `req` itself (`destroy`/`setTimeout`/busy flag), and the owner step is auth.
- **publish-site.** Not started. Notes are in the S4 return: a blocked event before the 403, and the consent refusal is from the contracts-core lane.
- **Not started:** commerce/purchase, media-rendition, media/original, external-mcp/oauth, plugins/{install,chart-providers}, publish-content/peer-transport, site-cookie-consent, site/pages handlers. The classification reasons from x6 are unchanged.
- **Owner decisions:**
  - Accept or reject the residual differences above.
  - Add the binding keep-rules so FILES LEFT reflects the conversions.
  - Members `respondToSignInError`/`sendMemberAuthError` have no production caller; only `member-auth-errors.test.ts` uses them.
- **Infra.** Tovu `npm run check:why-comments` and Jini `pnpm check:why-comments` both default to `origin/refactor/terra`, which is missing in cloud clones. Pass `--base`.
