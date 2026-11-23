PARTIAL: SEC-3 not started (unblocked, ran out of the 2 h budget); SEC-6/7/8/12/14 blocked on open OD-3 items (and K4-seam-5.J / A-K2-0a.chip); SEC-9..13 wait on SEC-8; SEC-IDX (Tovu docs) not applied

# SEC-1, SEC-2, SEC-5 — Jini security parity (branch `codex/sec5-jini`)

Base: `origin/codex/sec4-jini` `4e5f6396` (SEC-4, approved). Spec: Tovu `origin/plan/whats-left-1122`
`plans/P9-SEC-plan-v2.md` §1b, §2 SEC-1, SEC-2, SEC-5, with `P9-SEC-check-v2.md` items 4 and 6.
Owner decisions file: only OD-1 is answered; OD-3 (a–d), OD-2, OD-4 and OD-5 are still open.
Tovu oracle: the Tovu checkout at `0df57a3a` (`apps/admin/src/features/security/**`).

## Order chosen and why
SEC-4's next steps by §5: SEC-1 (lane C) unblocks SEC-5 (lane A, needs SEC-1 + SEC-4); SEC-2 needs
SEC-1; SEC-3 has no dependency. I built SEC-1 → SEC-2 → SEC-5. SEC-6 needs OD-3 (a), which has no
answer, so lane A stops at SEC-5. SEC-3 (user-management, 110 min) was next but did not fit the cap.
§5 lists SEC-IDX (a Tovu docs edit on the plan branch) before all SEC dispatch. This run was
dispatched explicitly, the same as SEC-4, and must not push to `plan/*`, so SEC-IDX is **not applied**.

## Commits (all pushed to `origin/codex/sec5-jini`)
| step | red (tests first) | green / follow-up |
|---|---|---|
| SEC-1 | `48008f937` (8 failed / 3100 passed) | `fbcc1493a` |
| SEC-2 | `f36de50ce` (2 failed / 2 passed) | `c06b28b86` |
| SEC-5 | `52ba709f2` (31 failed / 268 passed in `src/security`) | `fb70e4c48`, `1bdfc8a55` (api baseline, complexity split) |

## SEC-1 — module shape, translator, header, TabBar, root-key tab options
- `security({ ui }, { t?, rootKeyScopeNotice?, rootKeyTab?, tabIcons? })` binds through the injected
  `ui.bindReact` (media/comments shape); the module no longer imports admin's `bindReact`.
- `rootKeyTab: { generate?, defaultEnvVarName?, previewRequired? }` merges into the `root-key` tab's
  params beside `scopeNotice`. Stock params stay `{}` (pinned).
- The page renders kit `TabBar` (replacing `Tabs`) with handles `security-tab-access-tokens`,
  `security-tab-site-key`, container `security-tab-bar`, translated handle labels, and host `tabIcons`.
- Header: kicker + h1 + description, all through `t`. The Provider takes a live `t` prop that flows
  through a context, so a locale change relabels in place. A test pins that the tab controller does
  not reload.
- Files: `react/index.ts`, `messages.en.ts` (+ `englishSecurity`, `SecurityTranslator`),
  `react/hooks/SecurityPorts.hooks.ts`, `react/hooks/SecurityPage.hooks.ts`, `react/pages/SecurityPage.tsx`,
  `index.ts`. In-repo callers: `security.test.tsx`, `security-editor.test.tsx` (relative imports,
  per check item 4) now pass `{ ui: reactModuleUi }`. Only the call argument changed. No other caller exists in `packages/` or `examples/`.
- Tests: `react/__tests__/security-module.test.tsx` (11). These port the tab-visibility and deep-link cases of
  `T:__tests__/Security.unit.test.tsx` (read-only → `[access-tokens]`, a root-key deep link lands on
  Access tokens and never mounts the root panel; an unknown tab falls back; the grant table of
  `use-security-permissions.unit.test.tsx` as the module's `security.read` / `admin.security.tokens.manage`).
- **Mutation:** drop `permissions: ['admin.security.tokens.manage']` from the `root-key` tab in
  `security.module.ts` → red: `grants ["security.read"] offer tabs ["access-tokens"]` and the
  read-only deep-link case (`Tests 2 failed | 9 passed (11)`). Restored → `11 passed (11)`.
- Changeset `.changeset/p9-sec-1.md`: **minor**. SEC-1's API delta in the plan says "(breaking,
  minor)", which overrides the §1 patch rule for this step.

## SEC-2 — owner-controls slot
- `feature.react.Provider` takes `ownerControls?: ReactNode` (context). The page renders it once, inside
  `data-jini-part="security.owner-controls"`, above the TabBar, only when the page is visible.
- Tests `react/__tests__/security-owner-controls.test.tsx` (4): once and before the TabBar; absent
  (and never mounted) when denied; no wrapper when not supplied; mount counter stays 1 across two tab
  changes.
- **Mutation:** stop rendering `vm.ownerControls` → `Tests 2 failed | 2 passed (4)`. Restored → `4 passed`.
- Changeset `.changeset/p9-sec-2.md` (minor: new Provider prop + `useSecurityOwnerControls` export).

## SEC-5 — status presentation, generate visibility, typed refusals
- Rules (`rules.ts`, pure, return message keys + vars): `rootKeyBadge` (none / key file / env with
  the server's `envVarName`, else the host `defaultEnvVarName`, else an unnamed label; tone
  warning/success/info), `rootKeySourceNote` (invalid env / invalid file + path / env / file + path / none).
  Jini contains no product env-var name.
- Controller: generate guard is now `!status || status.active || status.state !== 'missing' ||
  status.source !== 'none'` (Tovu's `source !== "none"` guard). Optional `{ describeError }` →
  `generateFailure` `locked` (`KEY_DEPENDENT_DATA`|`KEY_MISMATCH`) / `refused`
  (`KEY_INVALID`|`SITE_META_UNREADABLE`) / `already-exists` / `generic`. The shown `error` is the
  described `detail` or fixed copy. The controller never reads `Error.message`, and a throwing describer reads as no
  detail. Success clears `generateFailure`.
- React: `describeError` is a module option provided by context. The tab is split into `RootKeyScopeNotice`
  (with a production-only line, P14) and `RootKeyStatusCard` (badge, fingerprint `<code>` inside a
  hinted `title`, source note with the path as `<code>`). Generate hides when `rootKeyTab.generate === 'hidden'`.
- Tests (33 new). `__tests__/root-key.controller.test.ts` ports `T:__tests__/site-key-generate-error.unit.test.ts`
  (each class, unknown code → generic, no describer → generic) and adds: refused for
  `{active:true,state:'active'}`, `source:'env'`, `source:'file'`; a key-valued `Error.message` absent
  from `JSON.stringify(snapshot)` and from `console.error/warn` with and without a describer; success
  clears the failure. `__tests__/rules.test.ts` ports `T:__tests__/site-key-status.rules.unit.test.ts`
  (inactive none/file/env → None; server name; default name; file ignores env name) plus the source
  notes. `react/__tests__/RootKeyTab.sec5.test.tsx` covers the real module, hook and controller: env badge, host-default
  name, hinted fingerprint, path as code, invalid note, production note only in production, create
  shown by default / hidden by option, and a KEY_INVALID detail shown with the fixture key absent from the DOM.
- **Two existing assertions changed deliberately (behaviour change per plan, P12/P16):**
  1. `root-key.controller.test.ts` "reports a refused generation with the fixed message": the expected
     copy is now `'Root key could not be created.'` (was the recovery copy). I **added** an assertion that
     the raw message (`PRIVATE`) is absent from the snapshot.
  2. `react/__tests__/RootKeyTab.test.tsx` "shows the status line" became "shows the status badge,
     hinted fingerprint and source note". The raw `state · fingerprint · source` line is replaced by
     P12/P13, and the test now asserts that the old line is gone.
- **Mutation (plan-named, check item 6):** replace the whole guard with `if (!status) return
  Promise.resolve(false);` → `Tests 5 failed | 42 passed (47)` in `root-key.controller.test.ts`
  (active-key, missing-with-data, `{active:true,state:'active'}`, `source:'env'`, `source:'file'`).
  Restored → `47 passed`.
- **Extra mutation (redaction):** show `(error as Error).message` as the generate error → 10 red,
  including "an error whose message is a key never reaches any snapshot field or console" and the
  DOM KEY_INVALID case. Restored → `299 passed`.
- **Scope note:** P20 (locked = status **or** generate refusal, which gates unlock and start fresh)
  stays with SEC-7. SEC-5 only exposes `generateFailure.kind === 'locked'` in the snapshot.
- Changeset `.changeset/p9-sec-5.md` (minor: new rule exports, controller option, copy change).

## Test counts (`npm --prefix packages/admin run test`)
- Baseline at the SEC-4 tip: **3097** passed (measured as 3108 total − 11 new SEC-1 tests in the red run).
- Final: **255 files, 3145 passed, 0 failed** (+48: SEC-1 11, SEC-2 4, SEC-5 33). No test removed or skipped.

## API delta (`pnpm api:update`, `@jini-ai/admin` only)
- SEC-1: changed `./security#securityMessagesEn`, `#securityModule`, `./security/react#security`;
  added `./security#SecurityTranslator`, `#englishSecurity`, `./security/react#SecurityModuleOptions`,
  `#SecurityRootKeyTabOptions`, `#SecurityTabIcons`, `#SecurityTranslator`, `#useSecurityTranslation`.
- SEC-2: changed `./security/react#security`; added `./security/react#useSecurityOwnerControls`.
- SEC-5: changed `./security#createRootKeyController`, `#securityMessagesEn`, `#securityModule`,
  `./security/react#SecurityModuleOptions`, `#security`; added `./security#DescribeRootKeyError`,
  `ROOT_KEY_ALREADY_EXISTS`, `ROOT_KEY_GENERATE_FAILED`, `RootKeyBadgeTone`, `RootKeyCopy`,
  `RootKeyErrorDescription`, `RootKeyGenerateFailure`, `classifyRootKeyGenerateFailure`,
  `rootKeyBadge`, `rootKeyGenerateFailureText`, `rootKeySourceNote`. No removed exports.
- No new port token and no port-type change (`RootKeyPort`, `SecurityApiPort` untouched). D5 is respected.

## Gates (final tree)
- `pnpm install --frozen-lockfile`: ok. `pnpm -r build`: EXIT 0 (full rebuild after SEC-1);
  `pnpm --filter "...@jini-ai/admin" build`: EXIT 0 after SEC-5.
- `pnpm typecheck` (whole repo, including examples): EXIT 0.
- `pnpm guard`: ok. `pnpm api:check`: ok (40 packages, 695 entries, 17264 symbols).
- `check:hooks`: ok. `check:why-comments --base origin/codex/sec4-jini`: ok, 0 blocks lost.
- `check:complexity` / `check:size`: no new violation in touched code. The remaining reds are the same
  pre-existing set the SEC-4 report lists (`handleRpcError`, `readConfirmationResume`,
  `refusalError`, `ErrorNotice`, `cms/redirects.ts` 513 lines), plus `daemon/agent-executor/launch.ts`
  (952 > 950 lines, `createAgentExecutor` 418). This run does not touch that file.
- Owner rules: no Express or vendor names. Hooks are injected (`use…Hook = use…` defaults on
  `useSecurityPage`, `useRootKeyTab`). Every `_optional = {}` pad is kept. Every function is ≤ 80 lines
  and has complexity ≤ 10. `jini-*` classes only. No re-export shell files. Wiring section added to
  `packages/admin/README.md` ("Wiring: Secrets (`security`)").

## Steps left
- **SEC-3** (UM recovery card; no dependency). Next to build. It must address check-v2 item 5:
  a separate status-load failure test, the Reset `busy || !password` pin, and injected wrapper hook calls.
- **SEC-6** (reveal + clipboard): BLOCKED on **OD-3 (a)**. **SEC-7** follows SEC-6 and needs OD-5 (DC-5).
- **SEC-8**: BLOCKED on **K4-seam-5.J** and **OD-3 (b)**. SEC-9 → SEC-13 follow it. SEC-10/11 also need
  **A-K2-0a.chip**. SEC-12 needs **OD-3 (c)**.
- **SEC-14**: needs **OD-3 (d)**. **U-AUTH-1…3**: U-AUTH-1 needs RT-K1-0.J merged; after SEC-3.
- **SEC-IDX** (Tovu `plan/whats-left-1122` docs): not applied by this run.
- Host side (SEC-T0/T1a): pass `{ ui: reactModuleUi }`, `rootKeyTab: { generate: 'hidden',
  defaultEnvVarName: <host env name>, previewRequired: false }`, `tabIcons`, the host `t`,
  `ownerControls` (TOTP, recovery, passkeys), and a `describeError` that maps `ApiError.code` /
  `body.detail` through the host redactor.
