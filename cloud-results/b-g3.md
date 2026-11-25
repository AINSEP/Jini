DONE 394cf73cf5 aa482306e

# b-g3 (2026-11-25): P6 visitor chat onto AG-UI — continuation run — Tovu + Jini `integ/b-g3-2026-11-25`

DONE means every item of the cloud-dispatchable scope is built and green in cloud. It does NOT mean the P6-T4 parity gates are signed off: every gate still needs the Chrome + Electron canary run in the UNVERIFIABLE list. P6-T5.T (admin default flip) and P6-T2.R stay gated. The AG-UI admin default is still OFF.

Unattended continuation run. Opus coordinated. Builders: Opus-high for every approval, resume, authorization and browser-effect slice (P6-T2.T step 4, P6-T3.T, Stop/shutdown, the refactor) and Sonnet-high for the P6-T4.T Errors / Attachments / Cost footer gates. I read `AI-Dev-Shop/agents/programmer/skills.md` (**Programmer v1.7.5, 2026-11-05**) first, and every brief carried its rules plus the run's iron rules:
- test-first, with a named mutation for every characterization
- inject everything; hooks as REQUIRED props; no re-export shells
- fn ≤ 80 lines, complexity ≤ 10
- why-comments
- approvals only through the EXISTING card
- plain-words errors
- Jini neutral

**Run facts**
- **Bases and tips:** Tovu started at `438c1d3a9` (previous b-g3 report). Code tip `394cf73cf5`; this report is the commit after it. Jini started at `701eb932e`, code tip `aa482306e`. **No Jini code changed in this run**; the only new Jini commit is this report copy.
- **Setup:** Node 24.22.3. Jini `pnpm install --frozen-lockfile && pnpm -r build`. Tovu `npm ci --ignore-scripts` (root, admin, desktop, site-chat), then `npm run link:jini` (`JINI_PACKAGES_DIR=/home/user/Jini/packages`), `prepare-desktop-hooks`, and a build of `packages/{contracts,sdk}`. Each builder worked in its own git worktree (hardlinked node_modules, `../Jini` symlinked) on `integ/wip-b-g3c-<x>`. The coordinator merged each one `--no-ff` into `integ/b-g3-2026-11-25` and pushed after every item.
- **First step:** `cd apps/desktop && npm run gates` gave 6/6 PASS before any change and 6/6 PASS at the tip.
- **Rules held:**
  - no force-push, no `--no-verify`, hooks untouched
  - no codebase-memory tools
  - `main`, `plan/*`, `release/*`, `codex/*` and `integ/merge-*` untouched
  - no tag, no publish
  - no RemoteTrigger
- **Caps:**
  - Wall clock 09:01–10:55 UTC (about 1 h 55 min), under the 2.5 h cap.
  - Coordinator about 165 tool calls.
  - 12 subagent dispatches (1 continuation by message), never more than 4 at once. Each stayed ≤ 50 calls, and every builder that ended PARTIAL at its cap was continued by a fresh dispatch.

## AG-UI version and per-surface conformance

`@ag-ui/core` / `@ag-ui/encoder` / `@ag-ui/client` are **1.0.4, exact** (pinned by the first run; nothing changed here). `PROTOCOL_VERSION === "1.0"`.

| surface | conformance evidence (all PASS at the tip) |
|---|---|
| admin chat | `assistant-transport.ag-ui.conformance.unit.test.ts` 1/1. **New:** the live server's approval wire (first segment with an ordinary card + an approval card + an interrupt, the resume segment, the 400 refusal) is pinned to a golden that the real `createAdminAgUiRunClient`/`HttpAgent` replays: `admin AG-UI golden wire: the segments the admin client replays are the live server's bytes` (server) and `admin AG-UI resumes a real parked approval and still renders ordinary cards` (client). |
| assistant chat (server route) | `assistant-ag-ui-wire.conformance.test.ts` 2/2. The approval interrupt is the standard 1.0 `RUN_FINISHED { outcome: { type: "interrupt", interrupts: [{ id, reason: "confirmation", message, metadata }] } }`. Resume is a 1.0 `RunAgentInput` with exactly one `resume` entry and `parentRunId`. |
| visitor chat | `site-assistant-transport.ag-ui-conformance.test.ts` 1/1. **New:** page actions travel as standard `TOOL_CALL_START/ARGS/END` (`toolCallName: "tovu.page_action"`, `toolCallId` = registry invocation id). Stop on a parked approval sends a 1.0 resume with `status: "cancelled"`. |

## Sheets

| sheet | built by | status | tests (name → red evidence / mutation → red) |
|---|---|---|---|
| **P6-T2.T step 4, admin server** | Opus ×2 (`a1`, then continued as `a1b` after the call cap) | **DONE** `6505e10fb` `c68f46529` `a8b4710aa` `643e48338` (merge `83f636320`) | New `W/server/__tests__/assistant-ag-ui-resume.integration.test.ts` (0 → 11 tests with E and F below). Red on base: the module did not exist (`ERR_MODULE_NOT_FOUND`). Each named mutation, run then reverted: **(1)** `admin resume answers the parked card exactly once through the daemon's guarded answer`: M start a new daemon run on resume → 8/9 red; M redeem twice → red. **(2)** `admin decline runs nothing`: M deny→allow → red. **(3)** `admin resume by another owner or for another run is refused in plain words without consuming the claim`: M owner taken from `forwardedProps` → red. **(4)** `replayed admin resume does nothing`: M claim after the await → red. **(5)** `closing the admin interrupt response leaves the daemon run alive`: M cancel on every close → red. **(6)** `ordinary admin cards still stream without an interrupt`: M interrupt every mcp-ui card → red. **(7)** `Stop on a parked admin approval settles it once` + `Stop before the resume settles the parked admin approval: the late resume answers nothing`: M Stop does not settle → red. Only the second test catches this; the race test alone survives it. **(8)** `shutdown abandons every parked admin approval and clears its timer`: red, `shutdownAdminApprovals` missing. **Design.** New `W/assistant/admin-ag-ui-approvals.ts` provides `redeemAgUiApproval({ owner, threadId, parentRunId, interruptId, decision })` → `"resumed" \| "expired"`. It is server-neutral, claims synchronously, and answers once through the daemon's EXISTING guarded exchange answer (`/api/admin/v1/mcp-ui/tool-calls` + `RUN_PRINCIPAL_HEADER` = session owner). `handleAdminAgUiResume` is dispatched before any start. The segment order is: park → the unchanged card event → close text → interrupt with `metadata.exchangeId` (already in the card HTML and not authority) → detach without cancel. The resume reconnects the SAME daemon run from the cursor after the card, so the card and earlier deltas do not repeat. Only cards that have both `confirm` and `cancel` are interrupted. Refusal: 400 `{"error":"This request expired. Ask again."}`. Lifetime gate PASS: closing the interrupt response is a detach, and the daemon run survives. |
| **P6-T2.T step 4, admin client** | Opus (`a2`) | **DONE** `aa4198ec4` (merge `03e018fc6`) | New `A/lib/__tests__/assistant-transport.ag-ui.approvals.unit.test.ts` (0 → 7 with E). Each test was run against the base transport: 6/6 red. **Test-first deviation:** the relay module was written before its tests, so red was shown by running the tests against base code. Eight named mutations, each red, each reverted: `the existing approval card answers a live AG-UI interrupt with one resume` (M post to the mcp-ui route; M two resumes on double-click); `an interrupt segment end keeps the turn busy and settles once after resume` (M interrupt RUN_FINISHED = completion); `ordinary cards still use their own route during an AG-UI run` (M redirect every card); `an expired resume shows the plain refusal once` + `… of a delivery-only turn … ends the turn once` (M raw server detail; M the refusal never ends the turn); `Stop while an approval is parked cancels the owned run once` (M Stop only aborts the fetch; M Stop keeps the answer right). New `A/lib/ag-ui-approval-relay.ts`. `useDockRendererRegistry({ agUiApprovals })` takes the poster as a REQUIRED prop and routes only a card whose exchange id matches a live interrupt; every other card keeps its route. |
| **P6-T3.T, server half** | Opus (`b2`) | **DONE** `87284c29d` `3e067a59a` `5505530bb` (merge `1feb199f0`) | `a refused model call never becomes a browser tool call` (unit + integration). M project provider `tool_use` as actionable → red; M executor mirrors the model call as a TOOL_CALL → red. `a disconnected page cannot begin or settle its old invocation` (unit; form fill without submit, accepted submit, rejected navigation target): red on base because begin was refused by the origin policy (new bug, fixed below); M release no-op → red. Delta `runId` (coordinator decision: the internal logical run is the begin correlator, not authority): M omit `runId` → red. New `W/assistant/site/visitor-browser-invocation.ts` (`projectVisitorBrowserInvocation`). `bindRequest(…, { deliverInvocation })` is wired on the AG-UI `/chat` path only, writes through the current segment (a T2 resume moves delivery without rebinding), and emits `TOOL_CALL_START/ARGS/END` with `toolCallId` = registry invocation id and `args` = `{ runId, invocationId, capabilityId, input }`. |
| **P6-T3.T, browser half + B192** | Opus (`b1`) | **DONE** `86dd5a28d` `1f5da2fdd` `9d2817829` (merge `e65cd7d22`); coordinator fixes `7fd96a56f` `1e8cfd599` | `attach failure still answers the question`: red (0 POSTs); M `headers()` rejection leaves `performRun` → red. `a failed rebind drops the stale page binding and still answers`: red. `Stop racing attach prevents the POST`: red (never finished); M remove the signal recheck → red. `an effect from another run is ignored`: M drop the per-turn run pin → red. `result carries the invocation id`: M model call id → red. `navigation persists before the document is replaced and never replays`: M assign before persist → red. Changes: `resolvePageHeadersForTurn({ frontend, signal })` is all-or-nothing; `acceptBrowserInvocation({ runId, action })` is live-only, never stored; begin uses the original attachment credentials before the driver; the terminal navigation handshake is unchanged. The transport had no navigation/form-fill `client_directive` branches left, so nothing was removed and the `client_directive` name stays. Counts: transport 40 → 43, recovery 1 → 4. |
| **P6-T3.T, end-to-end proof** | Opus (`d`) | **DONE** `9577c96e1` `3686f3fcd` (merge `20ed7b0ee`) | `a visitor page action begins and settles once through the AG-UI chat`, real stack through `/chat`: one `tovu.page_action` with `toolCallId` = invocation id ≠ model id; settle before begin refused; begin once; settle once. M model id as `toolCallId` → red; M delivery auto-begins → red. `a disconnected page cannot begin or settle its old invocation` (integration): M close no longer aborts → red; M close no-abort + release no-op → red. Release alone is double-guarded by the close-abort. Safety file 12 → 14. |
| **P6-T4.T Errors (dock)** | Sonnet (`c`) | **PASS in cloud** `aa800bb14` | E1 `a JSON refusal rejects the start once with plain words and never surfaces raw daemon detail`: characterization; the raw-detail mutation is caught by two existing tests (server redaction was proven by `b02620621`). E2 `a daemon or provider failure (RUN_ERROR) reports one plain error and completes once`: red on base (2 errors). E3 `a stream that ends with no reply and no terminal is an error, never a successful empty reply`: red on base. E4 `a dropped durable stream follows the same run again instead of starting a new one`: characterization, no mutation run. Fix: host `guardTerminalOutcome`; the root cause is in Jini (logged). |
| **P6-T4.T Attachments** | Sonnet (`c`) | **PASS in cloud** `6d3b49467` | `an AG-UI attachment reaches the selected agent and survives reopen and retry` (new `assistant-ag-ui-durable.integration.test.ts`, real acceptance + ledger): red on base (`attachmentIds` decoded `[]`); M omit from accepted context → red; M strip at persistence → red. `an AG-UI Stop of one run leaves another run's attachments and staging untouched`: red on base. `the durable start forwards the prepared attachment refs and never browser-owned authority` (client). Fix: bounded `assistant-ag-ui-launch.ts` (`attachmentIds`, `pluginRefIds`, `model`, `reasoning`); the principal stays server-stamped. Staging cleanup on disk is not exercised (the fake daemon does not stage). |
| **P6-T4.T Cost footer** | Sonnet (`c`) | **PASS in cloud** (client event level) | `tovu.usage on a delivery-only turn projects into the final events once` (M drop the usage projection → red); `a reconnect that repeats the last usage delivery leaves one footer with the same totals` (M append totals after reconnect → red). Both characterizations. |
| **P6-T4.T Approvals** | Opus (`e`) + the step 4 builders | **PASS in cloud** `f1a557ff2` `b700a47c6` (merge `6b7025ff3`) | `admin AG-UI resumes a real parked approval and still renders ordinary cards`: the live server's recorded bytes replayed through the real client. M server drops `metadata.exchangeId` → red on both sides; M server drops the ordinary-card frame → red on both sides; M client redirects every card → red. T2 allow / deny / expiry / foreign / replay witnesses are in the server file (referenced from the test's doc). |
| **P6-T4.T Stop** (incl. parked approval) | prior run + `a1b`, `a2`, `f` | **PASS in cloud** | Parked subcase now exercised server side (`Stop before the resume…`), client side (`Stop while an approval is parked cancels the owned run once`) and visitor side (below). The before-headers / subscribe / streaming / reopen cases are from the prior run. |
| **Stop / shutdown for parked approvals** (open MEDIUM from the prior run, plus its admin twin) | Opus (`f`) | **DONE** `bed11025f` `093faf54e` (merge `caaab5f83`) | `server shutdown abandons every parked visitor and admin approval once` (through `createApp(deps, { onShutdown })`): red on base (late admin resume streamed); M drop the admin hook → red; M drop the visitor hook → red. `visitor Stop while an approval is parked sends one cancelled resume and runs nothing` (site-chat + coordinator unit + server integration): red on base ×3; M Stop only local → red; M cancelled → allow → red. `a cancelled resume from another owner stops nothing`: M cancel before the owner claim → red. Shutdown runs first in `stopServingWithinGrace` (`index.ts`, `serve-listen.ts`). |
| **Complexity follow-up** | Opus (`g`) | **DONE** `d6455c064` `b7a5053fc` (merge `394cf73cf5`) — covering tests identical before/after (admin 69/69; website 74/75 with the known merge-21 red); mutations M1 (drop owner gate) and M4 red; M2 (resume 429) and M3 (confirm-only card) stayed green → logged test gaps | Behavior-preserving extractions for the five functions this run pushed over complexity 10 (`observe` 12, `readAdminApprovalCard` 13, `resumeVisitorApproval`, `handleAgUiRun`, `handleVisitorAgUiResume` 11). |
| P6-T1.T Chrome release witness | — | **UNVERIFIABLE in cloud** | See the list below. |
| P6-T5.T (SOL) | — | **GATED, not dispatched** | All six P6-T4 gates now pass in cloud, but the sheet requires Chrome + Electron evidence on the Local CLI canary with Claude, Codex and agy. The admin AG-UI default stays OFF. |
| P6-T2.R | — | **GATED, not dispatched** | Release-gated (one release after P6-T1's dual format ships). `/confirm` and the legacy writer stay. |

**P6-T4 gate summary (cloud):**

| gate | result |
|---|---|
| Resume | PASS (prior run) |
| Approvals | PASS (new) |
| Stop | PASS (parked subcase new) |
| Errors | PASS at dock level (new) |
| Attachments | PASS at launch-input level (new) |
| Cost footer | PASS at client event level (new) |

None is signed off without Chrome + Electron.

## Security calls made by the coordinator

- **Begin origin policy.** `visitorFrontendOriginPolicy` (`87284c29d`) admits a browser `Sec-Fetch-Site: same-origin` request that carries an Origin header. It is consulted only by Jini routes that use `requireSameOrigin`, and today that is only `begin`. `begin` is mounted only behind the owner gate, which has already applied the full visitor origin verdict. Page script cannot set `Sec-Fetch-Site`.
- **`runId` in the page-action delta.** This is the internal logical run that the registry binding is keyed by. It is a correlator, not authority: `begin` is gated on owner and bind token against the live binding.
- **`exchangeId` in the admin interrupt `metadata`.** It is already inside the card HTML, the resume body never supplies it, and the daemon checks the principal on every exchange answer.

## Gates (at the tip vs the run base `438c1d3a9`)

| gate | base | tip |
|---|---|---|
| desktop `npm run gates` | 6/6 PASS | 6/6 PASS |
| Tovu root tsc / admin tsc / site-chat tsc | 0 / 0 / 0 | 0 / 0 / 0 |
| Tovu `check:hooks` | ok | ok |
| Tovu `check:why-comments --base 438c1d3a9` | — | ok (32 files, 0 lost) |
| Tovu `check:boundaries` | 0 errors / 143 warnings | 0 errors / 143 warnings |
| fn ≤ 80 / complexity ≤ 10 on changed files (eslint) | — | 0 complexity / function-length errors (after `g`); `site-assistant.ts` file cap 560 → 571 (pre-existing over 500, logged) |
| site-chat node tests (all, with the React resolver hook) | 216/216 | **223/223** |
| website AG-UI + site + visitor + `assistant/site` suites | 122/125 (prior run's set) | **813/816**: the same 3 merge-21 reds (`AG-UI wire golden: an error frame`, `an explicit daemon 'error' frame with no message field…`, `site chat golden: page.navigate…`) |
| website composition `__tests__` (createApp changed) | 15 files with env failures (Postgres etc.) | identical per-file pass/fail on all 15 (30 failures, each also red at base) |
| website serving-app / boot | — | 9/9 + safety/routes/durable 40/40 |
| admin vitest (`lib`, `AssistantDock`, `ai-assistant`) | 2671/2673 | **2695/2697**: the same 2 i18n guard files (baseline-pruning entries in untouched features) |
| Jini `pnpm typecheck` / `api:check` / `check:hooks` / `check:why-comments --base 010c8cd87` | 0 / 0 / ok / ok | unchanged (no Jini code change) |
| Jini `guard` | 1 (HW3 `packages/admin/src/shell/lib/shell-failure-log.ts`) | same 1 |

## UNVERIFIABLE-IN-CLOUD

- **P6-T1.T release witness:** Chrome, with an already-loaded old widget and a fresh widget against one server (streaming, no reply, Stop, refusal/reference, approval display, save-before-navigation).
- **P6-T4.T sign-off:** Chrome + Electron on the Local CLI canary with Claude, Codex and agy:
  - Approvals: click the existing card, double-click, deny, expiry. Also confirm that the real daemon's `Last-Event-ID` replay matches the cursor recorded at the card; this was proven only against the fake daemon.
  - Attachments: attach, send, reload, retry; check on-disk staging cleanup after Stop.
  - Cost footer once after reload; dock banner copy for errors.
  - A real dropped connection reattaching to the same run; physical reload vs client Stop.
  - Explicit BYOK still choosing its own mode.
- **P6-T3.T in a real browser:** the site-chat page driver receiving `tovu.page_action`, calling `begin`, running the driver, and the response, plus navigation and a deferred submit across a real document unload. Also whether a real bridge stream failure rejects `rebind` promptly.
- **Visitor Stop on a parked approval:**
  - whether the `keepalive` cancelled POST arrives after Stop or unmount;
  - whether `frontend.headers()` still yields the tab credential after the turn's signal aborts;
  - whether unmounting the pane fires the same abort listener.
- **Browser bundle size** after site-chat imports `@jini-ai/chat/transports/ag-ui` (not measured).
- **The site-chat React suites need a verification-only resolver hook here:** the linked Jini resolves react-dom 19.2.7 while site-chat has 19.2.8. Run with `DEDUPE_REACT_FROM=file://…/apps/site-chat/package.json node --import <hook> …`, using a recursion-guarded `registerHooks` resolver that redirects `react`, `react-dom` and `scheduler` to the app. It is not committed.

## New bugs (all recorded in `development/open-bugs.md` § b-g3)

**Fixed**
- A visitor page could never `begin` because of the loopback-only origin policy (T `87284c29d`).
- **B192:**
  - an attach or rebind failure stopped the question from being sent;
  - a stale bind token stayed in the headers;
  - Stop during attach waited for the 10 s timeout.

  Fixed in T `86dd5a28d`.
- The AG-UI durable start dropped attachments, plugin refs, model and reasoning (T `6d3b49467`).
- Admin AG-UI gave double error callbacks and treated a bare EOF as success (T `aa800bb14`, host guard).
- The admin approval initially suppressed the existing card (T `c68f46529`).
- A test-only hang in the resume file (T `a8b4710aa`).
- The pre-existing never-exiting durable test (T `e67f16abd`).
- Site-chat tsc red after `acceptBrowserInvocation` became required (T `7fd96a56f`, `1e8cfd599`).
- **The prior run's OPEN MEDIUM:**
  - no Stop or shutdown caller for parked visitor approvals;
  - its admin twin.

  Fixed in T `bed11025f`, `093faf54e`.

**Logged**
- **Jini:** the shared AG-UI client forwards every RUN_ERROR and finishes a no-terminal EOF as success.
- **Jini:** after a durable acceptance, `durableStartEvent` drops segment frames before `onLiveEvent`, so the interrupt is invisible to that port. Admin taps the agent's event stream instead.
- **Jini:** `SURFACE_EXCHANGE_META` is not exported.
- **Admin:** after a refused (expired) resume, the card stays claimed and says "Answer sent."
- **Admin:** "one final usage" keeps the last usage event; confirm that it is cumulative against the real daemon.
- **AG-UI durable start:** still does not forward `pageContext`, `folders` or `agentPluginState`.
- **Admin resume segment:** reuses the first segment's `messageId` (harmless today).
- **Untested link:** `createServingApp` → `releaseOnShutdown` (the `createApp` hook is tested).
- **Test gaps:** visitor resume 429 under the rate limit; a confirm-only or cancel-only card must not be an approval.
- **File cap:** `site-assistant.ts` 560 → 571 lines (cap 500, pre-existing).
