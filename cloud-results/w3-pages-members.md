PARTIAL 324cb830ea 0f692df00: Pages editor core (PageEditor/usePageEditor size-debt STOP; page-editor-port/save need a core AdminContentRow contract), website features/pages (8, core-contract/post-seam prerequisites), member-login credentials/ready-providers/providers (K5-custom-credentials-3, agent-plugins), 4 held-patch newsletter files + deps-builders/delivery registrations, SQLite bindings and host wiring by design, routes (w3-rtfnd); gate reds listed: Jini log-safety +2 (moved, reported not hidden), Tovu dictionary-lookup-sinks guard (owner call). FILES LEFT 2,269 -> 2,185 (-84; excl. themes 2,158 -> 2,074)

# w3-pages-members — Pages, Dashboard/Activity/Observability, Members/Newsletter (2026-11-23/24, unattended)

Opus coordinator (high) + 19 builder subagents (Opus high; one Sonnet xhigh), at most 4 at a time. Builders only edited files; the coordinator reviewed the reports and diffs, committed per batch and pushed with plain `git push`. **Programmer skills loaded:** `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) was read before any work. Its test-first, named-mutation and pre-completion rules were written into the shared builder brief.

- **Branches:** Jini `codex/w3-pages-members-jini`, Tovu `codex/w3-pages-members-tovu`.
- **Never done:** force-push, `--no-verify`, tags, publishing, RemoteTrigger, codebase-memory tools. `main`, `integ/*`, `plan/*` and `release/*` were only fetched.
- **Base:** `origin/integ/merge-15-2026-11-23` (Jini `0a44b54ca`, Tovu `bd89a2aa8`). Its later gate-fix and doc commits were merged again at the end (Jini `556b3a9c5`, Tovu `bb8384d922`).
- **Prior lane branches merged on top:**
  - `codex/ex6-pages-dash-{jini,tovu}` and `codex/ex6-members-{jini,tovu}`.
  - Conflicts were trivial and resolved toward the newer side:
    - Jini `packages/{admin,cms}/package.json`: deep key union.
    - Tovu `why-comments-debt.json`: union by id.
    - Two `admin-nav-i18n` import lines: kept merge-15's `@/` alias.
    - `dashboard/{rules.ts,hooks/dashboard-port.hooks.ts}` (modify/delete, import-only on the merge-15 side): the deletion was taken, because the files moved to Jini.
  - Nothing was skipped.
- **Setup:**
  - Node 22.23.5 (this container has no `/opt/node24`; engines warn only), pnpm 10.33.2 via corepack.
  - Jini: frozen install 0, `pnpm --no-bail -r build` 0.
  - Tovu: `npm ci --ignore-scripts` 0/0/0/0 (root, admin, desktop, site-chat); `link-jini.mjs` 0; contracts 0; sdk 0.
  - Base comparison: clean worktrees `/home/user/base/{Jini,Tovu}` at merge-15, each with its own install, build and link. The base gates ran there.
- **Codex review:** pending for every diff below.

## FIX items applied (Tovu `origin/plan/whats-left-1122:reviews/rv1123*.md`)
**rv1123g, ex6-pages-dash:** every item was still present in the code and was applied.

| FIX | What changed |
|---|---|
| J1 | `Observability.useAdminKitValuesHook` is a required prop, bound in the host `HOST_BINDINGS`. |
| J2 | `ServerLogFilters` and `ServerLogsResult` now have one type-only owner, `@jini-ai/core/contracts/site/platform-server-logs`, beside the existing `ServerLogEntry`. Diagnostics, the cms route ports and admin consume it, and the duplicate admin DTOs are deleted. |
| J3 | `api:update` regenerated the admin, cms, core, diagnostics and user-management baselines. Five changesets `.changeset/p9-w3-pages-members-*.md` were added. |
| J4 | Host layout classes reach Jini through a required `layoutClassNames` prop. The Jini markup carries only `jini-*` classes; the host binds the exact old strings, so the DOM is unchanged. Mutation: kicker binding → 1 red → restored. |
| T1 | Bound together with J1. |
| T2 | `hardcoded-link-lists.ts` is identical to base. `jini-admin-tokens.css` moved from `admin-themes/` to `lib/` at the same import positions, so stylesheet order is unchanged. |
| T3 | All 71 moved why-comment ids were restored verbatim. 13 that name the product or a host path sit in the Tovu wiring files; stale ones get an appended `Now:` line. |

**rv1123f, ex6-members:** APPROVE, so there was nothing to apply.

## Batch table
| batch | model | files moved (Tovu prod → Jini) | importers | tests (+ named mutations) | status |
|---|---|---|---|---|---|
| A rv1123g FIX | opus-high | see above | 7 | obs 38, cms server-logs 6, diag 26; Tovu 429 + 132 node; kicker mutation | DONE |
| D admin members/dash/obs | opus-high | `members-i18n` (dictionary; host copy stays as K3), `members-api.types` deleted (core `AdminMember`) | 4 | 7 new; `hostCopy` mutation | DONE (rest is host wiring) |
| C newsletter core | opus-high | `errors, types, ports, campaign, hooks, lists, campaign-write-service, launch-gate, repo.memory, unsubscribe` + barrel deleted | 64 | 8 suites moved (77); 2 mutations | DONE |
| B members core | opus-high | `types, member-validation, ports, repo.memory, access-resolver, consent-service, member-admin-writes, member-credentials, member-challenge, member-sign-in, password-auth, trash-member, agent-tools, capability-card` + barrel deleted | 110 | 30; access-resolver fail-closed mutation | DONE |
| F website small | opus-high | `server-logs/agent-tools`, `tool-audit/repo.memory` | 17 | 5 new; 2 mutations | DONE |
| E why-comments | opus-high | — (71 comment restores) | — | gate logic re-check 71/71 | DONE |
| G pages editor leaves | opus-high | `use-interactive-flush`, `use-editor-html-jump` | 1 | 21; M1–M3 | DONE |
| H newsletter/members rest | opus-high | `send-pipeline`, `members/subscriber-directory`, `tool-metadata/{newsletter,members}` | 17 | seams 3, subscriber-directory 10; 2 mutations | DONE |
| I tool registrations | opus-high | `server-logs/tool-registrations`, `observability/tool-registrations`, `tool-metadata/server-logs` | 6 | 12; Tovu description pin written first; 2 mutations | DONE |
| J guard/why fixes | opus-high | — (R5 host-read vocabulary, N2, N4, SI isolation) | 1 | host-read pin first; M1/M2 | DONE |
| K Members hook | sonnet-xhigh | — (`useMembersHook` required) | 24 test sites | 385; no-op hook mutation → 24 red | DONE |
| L pages rules/i18n | opus-high | neutral half of `rules.ts` → `page-editor-rules`, `page-editor-i18n` (factory) | 10 | 36 moved + 3 new; routing mutation | DONE |
| M members write path | opus-high | `member-challenge-request`, `write-service` | 14 (+11 transport bindings) | 6 new first; M1–M4 | DONE |
| N manifest + obs hooks | opus-high | `newsletter/data-module-manifest` (K3 publisher), `use-observability-tab`, `use-recent-error-item` (additive AdminKit entries) | 11 | 5 + 10 moved; 4 mutations | DONE |
| O gate fixes | opus-high | — | 3 | notify + launch-gate mutations | DONE |
| Q member-login link | opus-high | `member-login/link-service` (required `reportFailure`) | 6 | 2 first; drop-report mutation | DONE |
| R tool-audit SQL | opus-high | `tool-audit/{repo,tool-gaps.repo}` (kysely optional peer, lockfile +3) | 5 | 8 new; M1–M3 | DONE |
| S members SQL | opus-high | `members/{repo,repo.rows}` | 16 | 7; M1–M4 | DONE |
| T newsletter SQL | opus-high | `newsletter/{repo,repo.rows,repo-subscribers,repo-sends}` | 4 | 7; M1–M3 | DONE |
| P + sweep + last fixes | opus-high | — (baselines, changesets, stale Tovu baseline rows, typecheck:tests, gate-evasion revert) | — | see Gates | DONE (2 log-safety + dictionary-lookup-sinks listed) |

The checkpoint commits are named after their batches; the full list of pushed SHAs is in the git log of both branches.

## Skipped (exact reasons)
- **Held-patch files:** `features/newsletter/{agent-tools,confirmation,subscriptions,tool-registrations}.ts`.
  - The B176/B201 patch in `cloud-results/combine-15-held/` rewrites them.
  - Only their import lines changed, so the patch needs a rebase over these import lines:
    - `confirmation.ts`: `errors`, `ports`, `types`.
    - `subscriptions.ts`: `errors`, `ports`, `types`.
    - `agent-tools.ts`: `campaign-write-service`.
    - `tool-registrations.ts`: `campaign-write-service`, `errors`, `hooks`, `lists`, `ports`, `types`, `send-pipeline`, `tool-metadata`, `DEFAULT_LIST_LIMIT`.
  - `deps-builders.ts` and `delivery/tool-registrations.ts` stay with them, because they import from the held `tool-registrations.ts`.
- **SQLite bindings stay as Tovu host bindings** (the integrations/webhooks precedent): `members/repo.sqlite.ts`, `newsletter/repo.sqlite.ts`, `tool-audit/repo.sqlite.ts`.
- **Other host bindings that stay** (by design):
  - `members/tool-registrations.ts`: needs runtime `@jini-ai/cms/core` and the assistant catalog wiring.
  - `members/mail-transport.ts`.
  - `server-logs/process-source.ts`.
  - `observability/test-error-message.ts`.
  - The admin controller/dependency hooks for members, dashboard and observability.
  - `members-api.ts` and `pages-api.ts`, the HTTP transports.
- **`member-login/{credentials,ready-providers}`:** need K5-custom-credentials-3 (`@jini-ai/integrations` has no custom-credentials export).
- **`member-login/providers.ts`:** needs 3 agent-plugins collaborators plus the K3 `tovu/` namespace; this is its own step.
- **Pages editor:**
  - `PageEditor.tsx` (`PageEditor#1` 221 lines) and `use-page-editor.hooks.ts` (`usePageEditor#1` 385 lines): size-debt components (STOP rule). Their worsened size rows are base-red, from owner commit `e73e946464`.
  - `page-editor-port.hooks.ts` and `page-editor-save.ts`: need a neutral core page/post row contract (`AdminPost`, `SaveConflict`). **Owner decision. Recommendation:** add a core `AdminContentRow` contract, then move the port and controller together.
  - Theme files (`ThemePage*`, `theme-*`, `use-theme-*`, `lib/theme-page-publish-state`): theme freeze.
  - Host half of `rules.ts` (routing, theme rows, version-conflict aliases).
- **Website `features/pages/*`** (8 files): need the page-HTML contract, a `PermissionGrantRegistry` core seam, the post feature and theme reads. These are core-contract and post-seam prerequisites, not import-line moves.
- **Dashboard host hooks:** `dashboard-i18n` uses the product `COMMON_I18N`; the `tovu.admin.*` disclosure and storage keys stay.
- **Routes** (`RT-K1-adm-{pages,members,newsletter}-*`, `RT-K1-pub-{members,site-3,ops-1}`): route files belong to lane w3-rtfnd. Only import lines were repointed, plus deps-builder bindings of injected collaborators (`mailTransport`, `reportFailure`).
- **Activity Log:** keeps its placeholder route (in `panels.tsx`).
- **Not done** (owner or follow-up):
  - `oidc-login.ts` has 4 bare catches (WARN error gate, moved verbatim; the Tovu debt row is kept).
  - Sibling user-management auth screens still default their hooks (`Login`, `TotpSettings`, `Passkeys`, `Users`), which belongs to the Users lane.
  - Behaviour notes for review:
    - `send-pipeline` omits absent optional mail fields instead of sending `key: undefined`; the wire JSON is the same.
    - `member-challenge-request` origin refusal now carries `cause`.
    - `link-service` now reports mail failures privately through `reportServerFailure`.
  - One artifact was accidentally published by a builder that used the Artifact tool to edit a README: a private, unshared copy of the Jini newsletter README (https://claude.ai/artifact/9Udbb8v37AktqFJvaN5BvQ). It was not deleted, because deleting is the owner's call.

## Gates (tip vs base merge-15; raw in `cloud-results/w3-pages-members-raw/`)
| gate | base | tip | new vs base | status |
|---|---|---|---|---|
| Jini build | 0 | 0 | none | ok |
| Jini typecheck | 0 | 0 | none | ok |
| Jini guard | 1 | 1 | none (HW3 `shell-failure-log.ts` is base-red) | = |
| Jini api:check | 0 | 0 | baselines regenerated for 5 packages only | ok |
| Jini check:cross-package (XP) | 1 | 1 | not runnable in this environment either time (`JINI_DECLARATION_BASELINE_DIR`); 2 listed lines | env |
| Jini check:size | 1 | 1 | none (members `repo.ts` was split into `repo.sessions.ts` + `repo.sql.ts`) | = |
| Jini check:complexity | 1 | 1 | none | = |
| Jini check:why-comments | 1 | 1 | none | = |
| Jini check:hooks | 0 | 0 | none (2 components, ok) | ok |
| Jini check:errors (WARN) | 0 | 0 | +1 WARN `member-login/oidc-login.ts` (4 bare catches moved verbatim by ex6-members; Tovu debt row kept) | LISTED |
| Jini check:log-safety | 1 | 1 | **+2 stored-error-text**: `admin/.../dashboard/hooks/use-dashboard.hooks.ts:201`, `cms/.../routes/system/server-logs.ts:50` (both from the ex6 pages-dash moves). A builder hid them behind a local variable; that evasion was reverted, so they are reported. They need a client-copy contract | **RED (listed)** |
| Tovu typecheck / typecheck:tests | 0 / 0 | 0 / 0 | none | ok |
| Tovu typecheck:scripts | 2 | 2 | none | = |
| Tovu check:size | 1 | 1 | none (PageEditor/usePageEditor rows are base-red, owner commit e73e946464) | = |
| Tovu check:boundaries | 0 | 0 | none (members mail transport injected through route deps) | ok |
| Tovu check:errors / complexity / hooks | 0 | 0 | none | ok |
| Tovu check:architecture | 1 | 1 | ratchet warning: runtime-only propagation 3.06 → 3.33; API surface 821 → 640 and hubs 335 → 266 improved | LISTED (warning) |
| Tovu check:why-comments | 1 | 1 | none in this lane after the restores (all 71 + 10 restored verbatim) | = |
| Tovu admin tsc | 0 | 0 | none | ok |

**Tests** (details in `cloud-results/w3-pages-members-raw/final-gates.md`):
- **Jini:** user-management 1514 (runtime-boundary ×2 is base-red); diagnostics 1127/1131 (`page-body` ×4 is base-red, `RegExp.escape` on Node 22); admin pages/screens/react/forms 1288/1288; cms system routes 27/27; core tool-metadata 24/24.
- **Tovu admin:** 230 files, 3877/3882. Base-red: `admin-literal-copy` and `credential-input-autocomplete`. **New red, listed:** `dictionary-lookup-sinks`. The guard does not recognise `COMMON_I18N` passed into the Jini `create*Translator` factories (members-i18n, page-editor-i18n); this needs an owner call on extending the guard.
- **Tovu website node tests:** 152 files, 137 pass. All 15 failing files fail in base too (14 directly; `set-token-agent-tool` is a timing flake that also fails in base when run alone). A members route shape pin keeps its 3 pre-existing unpinned keys.

## FILES LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs` from `origin/plan/whats-left-1122`)
| tree | FILES LEFT (all areas) | excl. themes |
|---|---|---|
| base merge-15 (Tovu `bd89a2aa8`) | **2,269** | **2,158** |
| tip (Tovu, committed head) | **2,185** | **2,074** |

By lane area (production sources), base → tip:

| area | base | tip |
|---|---|---|
| members | 24 | 3 |
| newsletter | 25 | 7 |
| member-login | 7 | 4 |
| adm-pages | 33 | 24 |
| pages | 10 | 8 |
| adm-members | 8 | 7 |
| server-logs | 4 | 1 |
| tool-audit | 4 | 1 |
| adm-other (dashboard/observability rows) | 380 | 363 |
| contracts-core | 83 | 82 |
