# consent — BLOCKED before build

Job: `cloud/jobs/consent.md`, read with `git show origin/cloud-plans-1105:cloud/jobs/consent.md` after fetching the branch. Rules: `cloud/jobs/COMMON.md`; override: `cloud/plans/TRIM.md`; plan: `cloud/plans/night/P6-consent-result.md`. Plans commit: `a2e6fe163f47309cda7d576a624dd511faea035d`.

## Outcome and branches

Stopped at the prerequisite assessment, as directed by the job's “report the plan problems before building … and stop” rule. Only this report changes. No runtime code, tests, dependencies, settings, content, schema, live/owner data, or deployments changed. The legacy engine remains intact.

- Jini delivery branch: `cloud/consent`, created from the exact prescribed base `6f507852d50cc5b22914917ad3a80f1168feccee`.
- Tovu inspected at the exact prescribed base `e327c07c8fc220fa8612ba1eb60c81c28b8a900f`; no changes or push.
- Fetched branch tips had advanced to Jini `a9b1d949ffb0363ddaa3df2278e8a3fcf034add5` and Tovu `ce99e7eba807b91d12926fe5889a9958032bc398`. Assessment uses the pinned commits above, not those moving tips.
- Pushed report SHA: `016b9ee6e` on Jini `cloud/consent` (push confirmed). This delivery-note follow-up is identified in the final response.

## Plan problems / evidence at the pinned bases

1. **The replacement consumes inert markup; it does not produce it.** Jini `packages/cookie-consent/src/client/dom.ts:41–65` selects `script[type="text/plain"]`, `iframe[data-src]`, and `template[data-jini-consent-resource]`. A normal `<script data-consent-category="analytics" src="…">` or `<iframe src="…">` is outside that selector and may execute/fetch before the client runs. Removing request-time conversion first changes behavior.
2. **The integration test still needs the engine being deleted.** `packages/cookie-consent/src/__tests__/cms-resource-release.integration.test.ts:8–39` imports and calls `gateConsentHtml` to manufacture the inert input. Its green status would not prove an independent authoring-to-client path. The old gate also emits script-specific templates (`packages/cms/src/consent/html/gate.ts:191–198`), which the replacement selector does not include; repurposing that gate wholesale is not a safe minimal converter.
3. **The listed save owners have no consent conversion hook.** Tovu `apps/website/src/features/pages/html-document-store.ts:384–406` and `:556–577` normalize embed quoting, validate plugins, and persist the HTML under the existing version/revision discipline. `features/theme/theme-files.ts:849–862` validates and writes supplied text verbatim. The binary import owner at `:877–885` writes bytes directly; the following restore owner explicitly restores original bytes. A fix only at `writeThemeFile` is not evidence that HTML import/reset paths are covered. The plan must name which alternate owners convert and how their existing byte-preservation contracts change.
4. **Save hooks alone cannot cover HTML added later.** Jini `packages/cms/src/widgets/html/plugin-export.ts:147–163` resolves plugin export templates, and `:169–177` adds `data-consent-category` to a live wrapper without an inert boundary. Tovu `server/inbound/public-http/http/site/render.ts:1732–1740` substitutes resolved embeds during rendering. Its comments at `:1708–1712` identify later theme partial/menu substitution too. The prerequisite needs an explicit conversion owner for generated output as well as stored input, without reintroducing the request-time whole-page engine. The plan says to prove generated embeds but leaves this placement/contract unresolved.
5. **Existing content and diagnostics remain prerequisites, not cleanup.** Rewriting future saves does not convert already-published pages/themes. The plan requires revision-preserving conversion before cutover, but supplies no bounded inventory/resume/cutover mechanism. Tovu `features/consent/readiness.ts` still derives its inventory from `gateConsentHtml`; `server/inbound/public-http/middleware/site-cookie-consent.ts:100–109` only inserts the replacement preview. Substituting it would not establish conversion coverage.

This is broader than wiring a small converter into the three cited save locations: alternate import/restore owners, generated markup, existing published content, and diagnostics need a coherent prerequisite first. The plan itself estimates **2–3 engineering days for conversion/migration plus 2–3 days for removal**. Static inspection confirms the prerequisite remains missing; it does not establish a more precise or larger day estimate. There is no evidenced safe deletion slice within this two-hour job, so no partial runtime cutover was attempted.

`parse5` dependency removal is not part of deleting the old consent engine: it remains used by CMS forms (`forms/html/html-authoring.ts:4`), navigation (`navigation/node/index.ts:5`), and fragment validation (`widgets/html/server-fragment.ts:3`), among other consumers. Keep the package dependency.

## Commands and validation

- `git -C /workspace/Jini fetch origin cloud-plans-1105` — succeeded after enabling the shell tool's network permission. It populated FETCH_HEAD only with this checkout's fetch configuration.
- `git -C /workspace/Jini fetch origin cloud-plans-1105:refs/remotes/origin/cloud-plans-1105` — succeeded; requested `git show origin/cloud-plans-1105:<path>` reads then succeeded.
- `git -C /workspace/Jini fetch origin integ/night-1105:refs/remotes/origin/integ/night-1105` — succeeded.
- `git -C /workspace/Tovu fetch origin night-1105:refs/remotes/origin/night-1105` — succeeded.
- `git -C /workspace/Jini archive origin/cloud-plans-1105 cloud/ai-dev-shop | tar -x -C /workspace` — succeeded; read its AGENTS.md and software-architect/programmer/tdd `skills.md` files.
- `source /workspace/shared/dev-env.sh` — failed: file missing.
- `/workspace/shared/start-postgres.sh` — failed: file missing. Neither setup script was supplied in this container; no replacement setup was invented.
- Source evidence: `git -C /workspace/Jini show 6f507852d:<path>` and `git -C /workspace/Tovu show e327c07c8:<path>` for the paths above; line numbers obtained using `nl -ba`. Focused `git grep` confirmed consent markers and existing parse5 imports.
- Navigation: Codebase Memory CLI and Graphify graph were absent. The local understand-anything graph had no cookie-consent/consent-html entries; source inspection was the fallback.
- Runtime tests, builds, tsc, and complexity lint: **not run**. No code/package was touched, and the job explicitly requires reporting this blocker before building. No green baseline or runtime safety claim is made. No tests were deleted, weakened, disabled, or skipped by edits.
- `git diff --check` — run on the report before delivery; result recorded in delivery notes.

## Left open / next owner

Finish and verify the conversion prerequisite in a separately scoped job: generic Jini conversion behind ports, complete owner wiring including generated markup, revision-preserving existing-content handling, and diagnostics based on actual converted content. Then perform the P4 rewiring/deletion with the plan's independent save/import/generated-content-to-client tests. Do not switch engines or delete the gate before that evidence exists.

BUG (existing, not fixed): ordinary authored optional scripts/iframes are not made inert by the replacement banner/client path; enabling it without conversion can release content previously gated by the legacy engine.

SETUP (not fixed): `/workspace/shared/dev-env.sh` and `/workspace/shared/start-postgres.sh` are missing.

Unrelated local artifact: switching Jini to the prescribed base exposed an untracked `packages/plugin-ui-ux-design/` directory. It was not edited, staged, deleted, or included in delivery.

## Delivery notes

Initial `git pull --rebase origin cloud/consent` found no remote branch (also confirmed by `git ls-remote --heads origin cloud/consent`); the first normal push created it successfully. Subsequent delivery uses pull/rebase before a normal push. `git show --check 016b9ee6e` and the follow-up diff check passed. Only `cloud/reports/consent.md` is staged/committed.
