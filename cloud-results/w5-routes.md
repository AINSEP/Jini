PARTIAL af6fa0c030 cb7f822ec: 8 render/sandbox/worker files still STOPPED (blocked on unowned render-context/blocks/template-render-data + features/post); OWNER-ASK site-share upload route-table row; ~225 other inbound files still counted moving (blocked via features/* owners or host adapters awaiting KEEP_RULES) | rv1123s FIX 1-5 applied | 10 of the 18 w4-STOPPED files resolved (6 SPLIT, 1 MOVED, 3 STAYS-HOST) + 8 more MOVED, 4 more SPLIT | FILES LEFT 2,065 -> 2,057 / excl. themes 1,954 -> 1,946

SHAs in the first line are the work tips before this report commit (Tovu `codex/w5-routes-tovu`, Jini `codex/w5-routes-jini`).

# w5-routes (2026-11-24): w4-routes STOPPED files + Codex rv1123s routes fixes

This was an unattended cloud run. The coordinator ran on Opus at high effort, and every builder was a Sonnet subagent at high effort (11 dispatches, at most 4 running at once, each under 50 calls). No Opus subagent was used, because no security seam was touched.

`AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) was read before any work, and **this report confirms it**. Every builder got a common brief built from its rules:
- test-first, with a named mutation for each behaviour fix;
- fresh evidence;
- the pre-completion checklist;
- the owner self-check list and the STOP rules.

## Setup
- **Bases.** Jini `origin/codex/w4-routes-jini` `dd99048e`. Tovu `origin/codex/w4-routes-tovu` `3fdbac1f8`. Both already contain `codex/w3-rtfnd-*` (`merge-base --is-ancestor` checked), so no merge was needed.
- **Jini.** `pnpm install --frozen-lockfile`, then `pnpm -r build`: 0, with 0 TS errors.
- **Tovu.**
  - `npm ci --ignore-scripts` in root, admin and desktop.
  - `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`, then contracts tsc and the sdk build, all 0.
  - The pre-push hook was installed with `core.hooksPath=apps/desktop/scripts/hooks`, which is what `npm prepare` does. It ran on every push and skipped, because this lane changed nothing under `apps/desktop`. That is also why the desktop gates were not run on the base.
- **Node.** Node 24 (`/opt/node24`), as in w4.
- **Base for gates.** The base is w4's final head, so w4's own head gate table (`cloud-results/w4-routes.md`) is the baseline. Every non-zero gate below was attributed by checking whether a finding sits in a file this lane changed.
- **Pushes.** Branches were pushed before any work and then after every batch. There were no force-pushes and no `--no-verify`.

## FIX items applied
**rv1123l 1–8 (w3-rtfnd).** Already applied by w4 (`ecae3b64a` / `fbb512dbf8`). Codex rv1123s confirmed they are present, so they were not re-applied.

**rv1123s 1–5 (routes):**
1. **Deferred body.** Jini `http-kit/src/deferred-body.ts` reuses the first read only for identical options (type, mediaType, limit). An incompatible read now gets a typed refusal, the new core `RouteBodyRefusal` reason `'incompatible-read'`.
   - Tests pin both concurrent and sequential calls: http-kit 8 → 13.
   - Mutation `deferred-body-reuses-incompatible-read`: RED (3) → GREEN.
   - Tovu refusal mappers checked: an unknown reason falls through to the existing unreadable 400, so no wire changes.
2. **Collection-list warnings.** `CollectionListsRenderDeps` gains a REQUIRED structured `warn(event)` with 4 codes, and Jini no longer calls `console`.
   - Tovu binds the existing `[collection]` formatting and sink in `server/runtime/composition/collection-list-warnings.ts`. It is injected at `static-tier.ts`.
   - A console-capture pin was green before the change and is green after.
   - Mutation `collection-warning-dropped`: RED (4) → GREEN.
3. **Class names.** `form-presentation-assets.ts` and `member-auth-script.ts` now take every emitted class and selector name from host inputs (`FormPresentationNames` +4 fields; new `MemberAuthNames`). This includes the script's `className` assignments and `querySelector` strings.
   - Tovu binds its legacy names in `form-wire-policy.ts`.
   - New sha256 pins cover the member style (4994 B) and script (16272 B). Both were green before the change and are unchanged after, and the form-presentation sha pin is also unchanged.
   - Mutation `legacy-class-hardcoded-in-jini`: RED → GREEN.
   - **Follow-on.** Jini `forms/html-render.ts` defaults are now `jini-form-field*`, with new `fieldHelpClass` / `fieldCheckboxClass` options. Tovu binds the legacy names, and a 6-mode contact-form output is byte-identical. Mutation `form-default-class-legacy`.
   - The member script is now a module-level template with `@@name@@` tokens, filled per call, to keep the size ratchet.
4. **Route-table pin.**
   - The zip install rows' `[installHandler]` are **preserved**: `mountAdminRawRoute` has a new opt-in `handlerName`. Mutation `raw-mount-handler-name-dropped`.
   - The site-share artifact upload row `[<a>><a>><a>]` → `[<anonymous>]` is **not preserved**. The old chain was a gate middleware, then `express.raw`, then the handler; keeping it would mean two fake pass-through layers. That is an **OWNER-ASK** (below). The fixture is left unchanged.
   - All pin drift is attributed in `cloud-results/w5-routes-route-table-drift.txt`:
     - (i) base drift that was red before w4: posts autosave, users, `/internal` daemon rows;
     - (ii) the one w4 row above;
     - (iii) other drift not from w4: site-assistant frontend-sessions collapsed into one `use`, plus the consent-client hash and the browser-analytics row in the consent variant.
   - The fixture was regenerated only into a scratch copy and restored byte-identical.
5. **The three STAYS-HOST files Codex disagreed with are moved or split:**
   - `admin-http/routes/publish-content/route-helpers.ts` is SPLIT. Body reading now uses Jini `transport-shared.bodyRecord`. The overwrite-key parser is consolidated onto Jini `readOverwriteEntityKeys` (import spec). The host translates the `"invalid"` sentinel to the relay's exact 400. Express writes, authorization and error reporting stay in Tovu. Pins: 9/9. Mutation `overwrite-invalid-sentinel-ignored`.
   - `admin-http/routes/widgets/preview-render.ts` is SPLIT. Registry lookup, config validation, resolution and fallback IR selection now live in Jini `cms/widgets/site/preview-render.ts` as `resolveWidgetPreviewIr`. Theme selection, document rendering and preview copy stay in the Tovu binding. Mutation `widget-preview-fallback-not-selected`.
   - `assistant/run-start-decisions.ts` is MOVED to Jini `daemon/src/run-start-decisions.ts`, with the shared type in Core `contracts/run-attempt` (`DurableAttemptStatus`). The Tovu file is deleted and its 10 importers are repointed. Tests moved 23 → 23. Mutation `run-start-decision-inverted`.

## Coordinator decisions (no new owner decision was needed except the OWNER-ASK)
- **Route-table rows are preserved by default.** Codex fix 4: "preserve or obtain owner approval". So every STOPPED file whose problem was its Express registration (chart-providers, theme-preview-refresh, site-imports, media original) keeps its exact Express registration and middleware chain in Tovu. The decisions move to Jini as framework-neutral `{status, headers, body}` functions.
- **chat-comparison, forms-submit and site-share stay in the host,** as w4 recommended:
  - chat-comparison is a dev-only K3 page behind an `app.use` namespace guard;
  - forms-submit is one five-handler `app.post` composition;
  - site-share is a `res.sendFile` and `/_share` terminator with product strings.
- **site-imports `/owner` keeps `express.urlencoded` with `inflate: true`.** The deferred reader's no-inflate owner rule would change the wire, so the parser stays in the host. Pure decisions moved.
- **Theme code stays in Tovu.** static-menus' theme glue (`scanMenuEmbedIds`, the docs-IA reserved ids) stays; generic resolution moved with injected collaborators.
- **Host bindings live in composition.** New host bindings (doc-render host, widget-render host, collection-list warnings) are in `server/runtime/composition/`. That is the composition layer, where bindings belong, so they do not count as moving.

## OWNER-ASK (recommendation given; nothing blocked)
- **Site-share artifact upload route-table row.** The change is `put /api/admin/v1/workspaces/:workspaceId/site-shares/artifacts/:token/:file [<anonymous>><anonymous>><anonymous>]` → `[<anonymous>]`, at row 217 in every profile variant.
- **Recommendation: approve,** under the same precedent as OD-1's handler-name substitutions. The gate and raw-body reading now happen inside the one raw-spec handler. Wire behaviour is pinned by w4's tests, and the sibling DELETE row already pins a single `<anonymous>`.
- **After approval,** regenerate with `UPDATE_ROUTE_TABLE_PIN=1` and check that the diff is exactly this row plus the drift already attributed in groups (i) and (iii) of `cloud-results/w5-routes-route-table-drift.txt`.

## Files: MOVED / SPLIT / STAYS-HOST / STOPPED
Prefix `apps/website/src/server/inbound/`. "SPLIT" means the logic is in Jini and the Tovu file is a real host adapter: Express registration, env, socket or theme glue, or the binding.

| file | result | Jini owner / reason |
|---|---|---|
| admin-http/routes/publish-content/route-helpers.ts | SPLIT (FIX 5) | cms `publish-content/{transport-shared,import}` |
| admin-http/routes/widgets/preview-render.ts | SPLIT (FIX 5) | cms `widgets/site/preview-render` |
| assistant/run-start-decisions.ts | MOVED (FIX 5) | daemon `run-start-decisions` + core `contracts/run-attempt` |
| admin-http/routes/plugins/chart-providers.ts | SPLIT | cms `admin-http/routes/plugins/chart-providers`. The pinned `app.use(base, guard)` and rows 295–297 are byte-identical. Wire pin 5/5 first. Mutation `chart-provider-cache-header-dropped`. |
| admin-http/routes/media/original.ts | SPLIT | cms `media/original-response` (`decideMediaOriginalReply`, lookup, document/inline decisions, SVG CSP). Tovu keeps the route registrar and the host writer `inbound/shared/media-original-writer.ts`, which uses `res.send` for Express's weak ETag/304. Wire pins first. Mutation `media-range-off-by-one`. A010 private 404 unchanged. |
| public-http/routes/site/media-rendition.ts | SPLIT (partial) | cms `media/rendition-negotiation` (spec parse, If-None-Match, Cache-Control). The original-video route uses the Jini decisions. Gating, ETag derivation and the 410/422/503 writers are still host. |
| admin-http/routes/assistant/get-chat-attachment.ts | SPLIT | Uses the cms original-response decisions. It was not merged with the existing Jini get-chat-attachment spec (that needs its own pins plus a reader-port decision). |
| admin-http/routes/system/site-imports.ts | SPLIT | cms `admin-http/routes/system/site-imports` (step lookup, failure mapping, gate/busy bodies, owner contract and validation). Socket policy, `express.urlencoded` (inflate) and `express.raw` stay host. Wire pins 3/3 first. Mutation `site-import-refusal-remapped`. |
| public-http/middleware/render-theme-override.ts | SPLIT | cms `public-http/middleware/render-theme-override` (`set/has/resolveRenderThemeId` over `{locals}`; stored-theme reader injected). `site-cookie-consent.ts` adopted `hasRequestRenderTheme` first. Tovu keeps the `app.use` glue. Mutation `render-theme-reader-ignores-override`. |
| public-http/middleware/theme-preview-refresh.ts | SPLIT | cms `public-http/middleware/theme-preview-refresh` (fresh HTML, revision cache, `runThemePreviewReload`). The `[requireAdminSessionMiddleware>forwardRejection]` chain and `next(error)` are unchanged. Mutation `reload-ignores-authorize`. |
| public-http/routes/site/pages/render-context/static-menus.ts | SPLIT | cms `.../render-context/static-menus` (`resolveStaticMenusForIds`). The theme gate, `scanMenuEmbedIds` and the docs-IA reserved menus stay (themes stay in Tovu). Mutation `static-menu-binding-loses-to-slug`. |
| public-http/http/site/render/doc/media-ref.ts | MOVED | cms `.../render/doc/media-ref`, with media collaborators injected through `DocNodeRenderDeps.host`. Mutation `media-ref-dep-ignored`. |
| public-http/http/site/render/doc/doc-nodes.ts | MOVED | cms `.../render/doc/doc-nodes` |
| public-http/http/site/render/doc/nodes-media.ts | MOVED | cms `.../render/doc/nodes-media` |
| public-http/http/site/render/media-placeholder.ts | MOVED | cms `.../render/media-placeholder` |
| public-http/http/site/render/widgets/media.ts | MOVED | cms `.../render/widgets/media` (`WidgetRenderHost`). Mutation `widget-render-host-input-ignored`. |
| public-http/http/site/render/widgets/social-entries.ts | MOVED | cms `.../render/widgets/social-entries` |
| public-http/http/site/render/widgets/post-content.ts | MOVED | cms `.../render/widgets/post-content` |
| public-http/http/site/render/contact-form-widget.ts | MOVED | cms `.../render/contact-form-widget`. Legacy form classes and `data-tovu-*` hooks are bound in `runtime/composition/widget-render-host.ts`. |
| admin-http/admin-dev-proxy.ts | MOVED (env glue stays) | http-kit `dev-proxy` (handler and upgrade-listener factories). The Tovu file keeps only the `TOVU_ADMIN_DEV_PROXY_URL` read and the SEA check. 6 tests moved. |
| admin-http/routes/forms/forms-write-error.ts | SPLIT | cms `admin-http/http/forms-write-error` (status/body mapping). The Express writer stays. |
| public-http/http/site/member-auth-script / form-presentation-assets (Jini) | FIX 3 | host-input class names |
| public-http/http/site/form-feedback-policy.ts | STAYS-HOST | Tovu product copy, legacy classes and `data-tovu-*` hooks bound onto Jini ports |
| public-http/routes/site/pages/request-policy.ts | STAYS-HOST | Express middleware with Tovu cache and `x-tovu-static-export` policy |
| public-http/routes/site/product-checkout.ts | STAYS-HOST | Tovu commerce copy, theme classes and host route |
| admin-http/admin-static.ts | STAYS-HOST | Express app composition (env and SEA branch) |
| public-http/routes/site/chat-comparison.ts | STAYS-HOST | Dev-only K3 product page behind a namespace guard |
| public-http/routes/site/forms-submit.ts | STAYS-HOST | Five-handler `app.post` route composition (pinned) |
| public-http/routes/site-share.ts | STAYS-HOST | `res.sendFile` plus the `/_share` terminator and product strings |
| public-http/http/site/{handlebars,liquid}-{render,sandbox,worker}.ts, worker-sandbox.ts, render/document-shell.ts | STOPPED (unchanged from w4) | Blocked on unowned `render-context.ts` / `render/blocks.ts` / `template-render-data.ts` and `features/post/contracts.ts`, which belong to another wave-5 lane's folder. Order stays: render-context → blocks/template-render-data → workers → sandboxes. worker-sandbox needs an injected "prepare worker dir" hook. |

Other inbound files the scanner still counts as moving (241 at base) were not in this run's budget. Most are blocked through `features/*` owners, `tovu-dep`, or w4's STAYS-HOST adapters, which still count until `plan.mjs` KEEP_RULES gains anchored rows (Codex rv1123s recommendation; `plan/*` is not writable here).

## Gates (no new red vs base = w4 final head)
**Jini.** The tip was rebuilt with `pnpm -r build`: 0, with 0 TS errors. `api:update` regenerated the cms/core/daemon/http-kit baselines.

| gate | result | attribution |
|---|---|---|
| typecheck | 0 | |
| guard | 1 | Only HW3 `admin/src/shell/lib/shell-failure-log.ts`, which predates this lane (same as w4). Five findings this lane introduced along the way (N1/N2 in comments, L3+L5 `cms → http-kit/range`, SI `render-theme-override → presentation`) were fixed by injection, not by debt rows. |
| api:check | 0 | |
| check:hooks | 0 | |
| check:errors | 0 | |
| check:why-comments | 1 | The same 10 blocks as w4 (admin, agent-plugins, agent-runtime, chat, core/errors/reporter, sidecar). None is in a file this lane touched. |
| check:size | 1 | Remaining: `cms/redirects/redirects.ts` max-lines 513, daemon `launch.ts` worsened, stale sidecar rows. None is in this lane's diff. This lane's own `memberAuthScript` (324 lines) was fixed by turning the script into a template. |
| check:complexity | 1 | Remaining: agent-runtime `session-results`, chat `event-projection`, core `reporter`, ui `ErrorNotice`. None is in this lane's diff. This lane's `mapImportFailure` (11) was split. |
| check:cross-package | n/a | Needs `JINI_DECLARATION_BASELINE_DIR` (a snapshot built from a separate clean checkout at the original pin), which was not built in this credit budget. No XP1/XP2/XP4 row names a file this lane changed. |

**Tovu:**

| gate | result | attribution |
|---|---|---|
| typecheck (+e2e) | 0 | |
| typecheck:tests | 0 | |
| admin tsc | 0 | |
| check:complexity / hooks / boundaries / errors | 0 / 0 / 0 / 0 | Boundaries had 0 errors. Stale depcruise allowlist rows for the deleted render files were removed. |
| check:size | 1 | Remaining violations: dev-auth, assistant-byok, PageEditor, post/page editor hooks, desktop, publish-agent-tools. None is in this lane's diff. |
| check:architecture | 1 | Same regressed metric as w4. No NEW cross-feature edge involves a file this lane changed. Propagation cost, API surface and hub count improved. |
| check:why-comments | 1 | 1193 lost, 1020 allow-listed, 173 open. All 40 blocks from this lane's files are closed: 38 rows say where the comment moved in Jini or Tovu, verified by search; 2 rows are obsolete, with the evidence in the row; one dropped `@file` comment was restored in Jini `http-kit/src/__tests__/dev-proxy.test.ts`. The 173 still open sit in files this lane did not touch (inherited). |

**Tovu tests.** 151 files were run: every changed test file, every test beside a changed source, and every test that references a moved or changed module. 129 Node files and 22 admin vitest files ran, each file alone, 3 at a time, on Node 24 with `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`. Result: **3040 pass, 8 fail in 7 files**, and every failure also occurs on the base:
- `serve-command-wiring.unit` (2), `content-post-get-by-slug` (1, generic-500 copy), `site-imports.characterization.unit` H4 (1, `configureSiteImports call missing`) and `route-modules.unit` (`members`, 1) were re-run in a clean `git worktree` at the base `3fdbac1f8` (shared node_modules and linked Jini), and they fail identically there.
- `render.golden.characterization` (1) fails on the same 9 drifting hash rows before and after the move. They are `widget:contact-form-*` ×4 plus the assistant rows; w4 listed these as base reds, and no `doc-node:*` row drifts.
- `tiptap-render-contract` (1) is the editor-schema drift guard (`Unexpected token 'default'`), which w4 lists as red on base.
- `resolve-html-page-embeds.integration` (1, the unknown-embed-type warning) was red on the builder's pre-move run and the same after.

Builder evidence: each batch ran its pins green on the unmoved code first, and each named mutation went RED and then GREEN, as listed per file above.

**Jini tests (Node 24).** These are the test files this lane changed: cms 15 files 127/127, daemon `run-start-decisions` 23/23, http-kit 3 files 33/33. The full http-kit suite is **824/824** (w4 had 799).

**Not run.** Desktop gates were not run (no `apps/desktop` change; the pre-push hook skipped them). Cross-package XP was not run (see the gate table). Full cms/core/daemon suites were not run either, to save credit; only the changed test files ran there.

## FILES LEFT
These counts come from `plans/P9-data/tools/scan.mjs` + `plan.mjs` taken from `origin/plan/whats-left-1122`. "Excl. themes" drops the `theme` and `adm-themes` areas.

| tree | FILES LEFT | excl. themes |
|---|---|---|
| base (w4-routes final) | 2,065 | 1,954 |
| w5-routes final | **2,057** | **1,946** |

The 8 files gone are the doc nodes ×3, media-placeholder, widgets/{media, social-entries, post-content} and contact-form-widget. `run-start-decisions.ts` was also deleted, but it was not counted as moving at base. The SPLIT files above still count as moving until KEEP_RULES classify host adapters.

## Notes for review
- **Test edits that are not pure moves.** `theme-preview-refresh.test.ts`'s harness now calls `asyncRoute`'s awaitable `.handler`, as that function's own doc recommends; the wrapper returned before the now-awaiting handler finished. Its stack regex also accepts an `async` frame. Same assertions.
- **Moved locals key.** It is now `renderThemeIdOverride`; the old key carried the product name. Nothing outside the moved module read it.
- **`get-chat-attachment` comment.** It says SVG is forced to download, but the code forces only HTML/XHTML (pre-existing; Codex rv1123l fix 15 territory). Behaviour was kept, and the comment was left for the owner of that file.
- **Dev proxy keep-alive agent.** It is now per proxy instance instead of module-wide (HW3 module-state rule). This changes connection pooling only.
- **Flaky Tovu test (pre-existing).** `render.test.ts` "forged reason" asserts `!/bad/` against HTML that contains a random UUID, so it fails about 1 in 50 runs. It is unrelated to this lane.
