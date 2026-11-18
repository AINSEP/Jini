# claude-ab/cookie-consent-cloud — ARGS RULE on packages/cookie-consent

Base `6c9effae4`. Nothing was run (no tests, build, typecheck or install). The evidence is the code edits and `git grep`.

## Functions changed (old -> new)
- `src/client/dom.ts:readCookie` `(doc, name)` -> `({ doc, name }, _optional = {})`
- `src/client/dom.ts:writeCookie` `(doc, { name, value, maxAgeS }, { domain } = {})` -> `({ doc, name, value, maxAgeS }, { domain } = {})`
- `src/client/dom.ts:purge` `(doc, storage?)` -> `({ doc }, { storage } = {})` (storage was optional, so it moves to the optional object)
- `src/client/dom.ts:activateInert` `(doc, { allowed, ran })` -> `({ doc, allowed, ran }, _optional = {})`
- `src/client/dom.ts:installOpeners` `({ api, doc })` -> `({ api, doc }, _optional = {})`
- `src/client/dom.ts:waiting` `(s)` -> `({ state }, _optional = {})`
- `src/client/runtime.ts:browserPorts` `(win)` -> `({ win }, _optional = {})`
- `src/client/runtime.ts:readPage` `(doc)` -> `({ doc }, _optional = {})`
- `src/client/runtime.ts:boot` `(win = window, options = {})` -> `({ win = window } = {}, options = {})`
- `src/client/index.ts:boot` has the same change as `runtime.ts:boot`
- `src/client/index.ts:createCookieConsent` `(required, options)` -> `(required, options = {})`
- `src/render/banner.ts:safeHref` `(url)` -> `({ url }, _optional = {})`
- `src/render/banner.ts:resolveCopy` `(input = {})` -> `(input = {}, _optional = {})`
- `src/render/css.ts:scopedSelector` `(selector)` -> `({ selector }, _optional = {})`
- `src/render/css.ts:parityCss` `({ colors })` -> `({ colors }, _optional = {})`

Each `_optional` added here is typed `Record<string, never>`.

## Left alone, and why
- `contracts/policy.ts:isFlags(c): c is Flags` is a type guard. A predicate cannot name a destructured key, and `server/receipt.ts:60` relies on the narrowing.
- `client/dom.ts:bindBanner` implements `ConsentBridge.mount`. It is registered as `mount: bindBanner` and typed by `BootOptions.bindBanner`.
- `REGION_SLOT.accept`, `ADAPTER_SLOT.accept` and `BRIDGE_SLOT.accept` implement the `SlotKind` interface.
- The `ConsentCssSyntaxError` constructor is a class constructor.
- 26 other exports already comply, for example `createCookieConsent` (runtime), `bootWithContext`, `purgeStorage`, the policy/plugins/consent-file/render/server/node exports and `installFeatures`.
- Private functions were not touched.

## Callers repointed
Proof grep: `git grep -nP "\b(readCookie|writeCookie|purge|activateInert|browserPorts|boot|safeHref|scopedSelector|readPage|waiting)\((?!\{|\))"` over `packages/cookie-consent`, `examples`, `packages/provider-plugins` and `scripts` returns nothing. Repo-wide, the same grep for the unique names finds only devops' own local `safeHref` (`static-export/transforms.ts`).
- **@jini-ai/cookie-consent production code: 26 call sites.**
  - `dom.ts`: `waiting` ×3
  - `runtime.ts`: 15 sites, covering `readCookie` 3, `writeCookie` 1, `purge` 3, `activateInert` 1, `waiting` 1, `browserPorts` 3, `readPage` 2 and `boot` 1
  - `index.ts`: 2
  - `entry.ts`: `boot` 1
  - `banner.ts`: `safeHref` 2
  - `css.ts`: `scopedSelector` 3
- **@jini-ai/cookie-consent tests: 41 call sites, call sites only.**
  - `anonymous` 7, `bridges.unit` 2, `client` 9, `client-dom` 12, `css` 6, `render` 5
  - No assertion or case was changed. The explicit `safeHref({ url: undefined })` and `purge({ doc })` cases are kept.
- **Other packages: 0.** `provider-plugins` uses `createCookieConsent` and `purgeStorage`, and neither call shape changed.
- **.mjs/.cjs callers:** `packages/cookie-consent/scripts/build-client.mjs:32 parityCss({ colors: null })` still works because only an optional parameter was added. `examples/cookie-consent-standalone/server.mjs` calls none of the changed functions.

## Docs updated
- The JSDoc `@example` in `runtime.ts:25` now reads `browserPorts({ win: window })`.
- The README, CHANGELOG and example READMEs show none of the changed call shapes, so none needed edits.

## Tovu callers
Checked with `git -C Tovu grep origin/refactor/terra -- apps packages development` per name and over the 60 files that mention `cookie-consent`.
- `apps/website/src/features/consent/validation.ts:57`: `safeHref(config.privacyPolicyUrl)` -> `safeHref({ url: config.privacyPolicyUrl })`
- `apps/website/src/features/consent/validation.ts:58`: `safeHref(config.secondaryLinkUrl)` -> `safeHref({ url: config.secondaryLinkUrl })`
- `development/scripts/__tests__/check-menu-href-allowlist-sync.test.ts:129` has `safeHref(x)` only inside a fixture string that a scanner reads and never runs. Updating it is optional: `safeHref({ url: x })`.
- No other changed function is called in Tovu. Tovu reads `client.min.js` only as a built asset.

## Unsure / follow-ups
- **`boot` keeps `win = window` as a destructuring default inside the first object.** This keeps `boot()` working and mirrors `bootWithContext({ win })`. A strict reading would put an optional `win` in the optional object, but that would mean adding a field to the exported `BootOptions`, which the rules forbid.
- **`resolveCopy` keeps its all-optional input object as the first parameter.** It only gained `_optional`, which avoids a `resolveCopy({}, copy)` shape.
- **`api-baseline/jini-ai__cookie-consent.json` is now out of date.** Public signature hashes changed for `boot`, `browserPorts`, `installOpeners`, `safeHref`, `resolveCopy`, `scopedSelector`, `parityCss` and the `createCookieConsent` variable. It needs `pnpm api:update`, which builds `dist` and so was not allowed in this run, plus probably a changeset for the breaking change. Neither was added.
- Nothing has been compiled or tested yet. Type-level risk is low but unverified, for example `purge`'s `storage?: StoragePrefixes | undefined` under `exactOptionalPropertyTypes`.
