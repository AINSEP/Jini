# xpkg-r1c-r2a — R1c DONE, R2a PARTIAL (steps 1–3 of 6)

Branch `wave2/xpkg-r1c-r2a` in Jini and Tovu, from `origin/refactor/terra` (Jini `65d73b0d5`, Tovu `232764af5`). Both pushed.
Prerequisite "moved admin fake": `packages/admin/src/react/testing-kit.tsx` (`fakeAdminKit`, `fixtureQuery`, entry `@jini-ai/admin/react/testing-kit`) is on refactor/terra; the sheet's check accepts it. Proceeded.

## Jini commits (all pushed; last `9cb50af8a`)
| SHA | What |
|---|---|
| 622a967f4 | R1c-1 `useAdminTheme` reads applyAdminTheme/resolveColorScheme from the kit (`useThemeKit` option defaulted to `useAdminThemeKit`); retires debt key use-admin-theme.ts |
| 2514fe222 | R1c-2 `ConsentLookFields`: module array -> `consentColorFields({ theme })`, fallbacks from the kit's `defaultAdminTheme` (`useThemeKit` prop); retires debt key |
| 2bf90a5b3 | R1c prereq: fake kit's `isMarkerOnlyEntry` ignored typed baseUrl/model (real rule: present and no recoverable fields). Red test first |
| 7829e4145 | R1c-3 `useProvidersTab` reads the six rules via `useRules` (defaulted to `useMediaProviderRules`); retires debt key |
| b6cc9882f | pure extraction `createRawEditorPort` so `useProvidersTab` fits 50 lines (was 56 at base) |
| 6d8c7f858 | drops `@jini-ai/ui` from admin peerDependencies / peerDependenciesMeta / jini.optionalPeers (devDependency stays: tests use the real fetch-query), retires manifest-peer debt key, removes the `admin→ui` same-layer edge in `scripts/check-package-layers.ts` + test (red while the edge stood) |
| 15887cc7c | R2a-1 T1 characterization (starter HTML for all 18 kinds + unknown, settings, groups, retype, drafts, patches, upload limits) snapshotted from the OLD code; fixtures are data (`__tests__/fakes/catalog-fixture.ts`), `fakeFormsCatalog()` |
| 67fe19878 | R2a-2 `formsCatalogToken` (`admin.forms.catalog`), required by the forms module, in `FormsPorts`; nothing reads it yet |
| 9cb50af8a | R2a-3 `html-rules.ts`: `formHtmlStarter({ fields, catalog })`, kinds + escaping via the port; `createFormEditorController({ catalog })`, `useFormEditor` props `catalog`; retires debt key html-rules.ts |

## Tovu commits (pushed; last `12bf526bb`)
`02b6ba012` consent suites use `render-with-jini-kits` (10 tests were red against Jini 6d8c7f858: "needs AdminKitProvider"); `9f2d73c21` `forms-catalog-ports.ts` binding (`satisfies FormsCatalogPort`) + `FormsHostPorts.formsCatalog` + test (checked against Jini 67fe19878); `12bf526bb` measurement harness passes the catalog (checked against Jini 9cb50af8a). Tovu is red against Jini 67fe19878..9cb50af8a only between its paired commits; all pushed.

## Red/green evidence
- R1c T1 red (`kit.applied` length 0 on old code), mutation (drop cleanup) turns 3 tests red. Consent fallbacks: characterized green on old code with the real strings `#ffffff/#202020/#d9d9d9`, kit-injected form red until the edit, mutation (hard-coded literal) red. Providers: 3 rule-port tests red before the edit. Layer test red while `admin→ui` stood. Fake fix: red test first.
- R2a: snapshot green on old code; mutations (unknown-kind fallback `text`->`email`; upload cap `>`->`>=`) each turn it red. T3 (every interpolated value of every kind through `catalog.escapeHtml`, 18 kinds) red before step 3; mutation (one unescaped option label) red for radio and checkbox-group. T2/T5 (catalog is the authority, inherited names `constructor`/`__proto__` fall back to text) written red-first. Snapshot unchanged after step 3.

## Gates (Jini, run after the last Jini commit unless noted; BASE = 65d73b0d5)
- Baselines before any edit: `pnpm guard` exit 0; `pnpm check:hooks` exit 1 with 32 base entries (saved `hooks-before.txt`); check:size and check:complexity pass; admin `vitest run --maxWorkers=2 --minWorkers=1` 213 files / 2846 tests green (`--maxWorkers=2` alone errors with this vitest + tinypool, minWorkers needed); Tovu typecheck exit 0.
- After 9cb50af8a: admin 218 files / 2878 tests green (+32 tests, none removed); `pnpm guard` exit 0 (only the advisory test-import count dropped 383->381); `pnpm check:hooks` output identical to base (no new key); `pnpm check:size` / `check:complexity` pass; `pnpm typecheck` exit 0 (after R1c); admin `npm run typecheck` clean; `pnpm check:peers` n/a (`check-peer-ranges.ts`: compatible).
- S3 prints one line: `forms/index.ts` already re-exported from `./ports.js`; I added `formsCatalogToken` to that existing line. S4/S5/S6/S10/S11 print nothing. S7 prints one line: the comment "Native color inputs need concrete colors rather than CSS variable expressions." is the first sentence of its new comment at ConsentFields.tsx (extended, moved with the code). S8 prints nothing (useProvidersTab 56 -> under 50). S9: `ConsentLookFields`/`useProvidersTab`/`useFormEditor`/`createFormEditorController`/`formHtmlStarter` keep or adopt `(required, optional)`; `recordingThemeKit()` and `fakeFormsCatalog(overrides = {})` are test helpers. S13 removed `expect`s: `'neutral'` -> `themeKit.theme.defaultAdminTheme.name` (fake's name), `{ theme: defaultAdminTheme }` -> same with `useThemeKit` added.
- Tovu: `npm run typecheck` exit 0 at `12bf526bb` (linked to Jini `9cb50af8a`); apps/admin full vitest (run mid-way, 14785 passed, 2 skipped) with 1 failing FILE `recharts-bundle-integer-ticks.unit.test.ts` (0 tests, vite sourcemap `readFile` error): not touched by this lane, treated as ENV/PRE-EXISTING (not re-run on the unmodified base). After the final Tovu commits: consent + forms-swap/forms-ports/forms-catalog suites 133 passed. `npm run check:size`/`check:complexity` print two "Worsened violation" lines in `apps/website/.../provider-plugins.ts` and `.../backstop.ts` (files this lane did not touch): BASE-RED, no new line from this lane.
- api-baseline: only `jini-ai__admin.json` committed (regenerated). `pnpm api:update` also rewrites 11 other packages' baselines (pre-existing drift on the base: agent-runtime, chat, cms, core, daemon, devops, http-kit, infra, mcp, platform, server); I reverted those and did not commit them. Admin's file also carried unrelated `useRedirects` drift in commit 67fe19878.

## Behaviour changes to know (all deliberate, per the sheet)
- `AdminShell`, `ConsentLookFields`/`ConsentSettingsPanel` and the media providers tab now need an `AdminKitProvider` above them (Tovu already mounts it in `main.tsx`). Not in CHANGELOG yet.
- `useAdminTheme`, `ConsentLookFields`, `useProvidersTab` gain an optional hook prop; their api-baseline hashes changed.
- Forms module now requires `formsCatalog`; `formHtmlStarter`, `createFormEditorController`, `useFormEditor` signatures changed (public exports: Tovu's only external caller, the measurement harness, is updated).

## Left (R2a steps 4–6) and the next step
Step 4 `forms/field-settings.ts` (NOT started; first edit is the test update): `fieldSettingsFor/groupOf/fieldTypeGroups/retypeField/settingsFormFromField/buildFieldSettingsPatch` take `catalog` in `required`; `UPLOAD_CHOICES` -> `uploadChoices({ catalog })`, `MAX_UPLOAD_MB` -> `maxUploadMb({ catalog })` (T4: catalog with 2 MiB clamps at 2 MiB; patternOf uses `catalog.isBrowserSafePattern`; `FIELD_TYPE_LABELS` becomes `Record<string,string>` with `?? type`). Callers: `forms-view.hooks.ts` lines 50, 84, 119 (read `formsCatalog` from `useFormsPorts` through an injected `usePorts` prop), `use-field-attributes-dialog.hooks.ts:46-47`, `controllers/field-attributes-dialog.controller.ts:13,29,63` (takes `{ field, catalog }`), `components/FieldSettingsRows.tsx:3,191` (receives `maxUploadMb` through the view). Tests to update: `__tests__/field-settings.unit.test.ts`, `field-settings-upload-choices.unit.test.ts` (dynamic-imports `field-settings` with a mocked cms: rewrite as a catalog without PDF), catalog-characterization (calls take `catalog: fakeFormsCatalog()`; snapshots must not change). Step 5 `forms/rules.ts:265`: inventory found `FIELD_TYPES` has NO consumer in admin or Tovu (Tovu's website imports cms's own `FIELD_TYPES`), so it becomes `fieldTypes({ catalog })` or is deleted as dead (it is a public export: baseline `FIELD_TYPES`). Step 6: delete the cms import from the three files, `rg -n "@jini-ai/cms" packages/admin/src/forms -g '!**/__tests__/**'` empty, retire debt keys `field-settings.ts`, `rules.ts`; manifest peer removal for `@jini-ai/cms` waits for R2b (`comments/adapters/memory.ts`, `media/html-attributes.ts`).
- Note for step 6: `forms/__tests__/html-starter.unit.test.ts` (starter -> `deriveHtmlForm` round trip) still imports `@jini-ai/cms/forms[/html]`; it verifies cms behaviour and belongs in Tovu or cms. Admin keeps `@jini-ai/cms` as a devDependency until it moves.

## Sheet inaccuracies found
- R1c "retire the admin→ui same-layer helper" is the `sameLayerEdges` entry in `scripts/check-package-layers.ts` (no helper test existed; I added one).
- R1c item 2's "six pinned colour strings": only three tokens (light bg/text/border) exist.
- R1c Tovu: no `jini-kits.ts` line needed (theme and rules already wired); instead Tovu's consent tests needed the kit provider. R2a Tovu: no `jini-kits.ts` line; the binding rides `forms-ports.ts` (`FormsHostPorts`).
- R2a: `FIELD_TYPES` consumers listed in the sheet (field-settings, FieldSettingsRows) do not exist; `MAX_UPLOAD_MB`/`UPLOAD_CHOICES` are the real module-level reads.
- `pnpm check:peers` does not exist (`check-peer-ranges.ts` via tsx instead).

## Overlaps with parallel lanes
`packages/admin/package.json` (R2b later), `scripts/injection-debt.json` (own keys only), `api-baseline/jini-ai__admin.json`, `apps/admin/src/integrations/jini-admin/forms-ports.ts` (Tovu).
