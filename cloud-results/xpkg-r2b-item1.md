# xpkg-r2b-item1 — R2b item 1 (media embed policy port) DONE; R2b and R2a complete

Branch `wave2/xpkg-r1c-r2a`, fast-forward on `origin/wave2/xpkg-r1c-r2a`, both repos pushed. Base: Jini `51999efa`, Tovu `ec43a234`. Setup: Node 24.22.3, `pnpm install --frozen-lockfile`, `pnpm --no-bail -r build` exit 0, Tovu `npm ci` (root + apps/admin), link-jini, contracts + sdk built. No subagents, no RemoteTrigger, nothing left running.

## Commits
| Repo | SHA | What |
|---|---|---|
| Jini | 5fa81190 | `parseMediaHtmlAttributes` / `isAllowedMediaHtmlAttributeName` take `policy: EmbedPolicyPort` in `required`; `MEDIA_HTML_ATTRIBUTE_ALLOWED_NAMES` and its `media/index.ts` re-export deleted; `embedPolicyToken` (`admin.media.embedPolicy`) in `media/ports.ts`, required by `mediaModule`, added to `MediaPorts`; `useEditMediaPanel(props, { usePorts = useMediaPorts })` reads it; cms peer / peerMeta / optionalPeers lines removed from admin's manifest; debt keys `media/html-attributes.ts` (cms import) and admin `manifest-peer` for cms retired; admin api baseline regenerated; `media/PORT.md` states the port. |
| Jini | 6ada1f20c | the media entry exports the `EmbedPolicyPort` type (a host needs it for `satisfies`; mirrors `FormsCatalogPort`); admin baseline regenerated. |
| Tovu | 720cb29f | NEW `apps/admin/src/integrations/jini-admin/embed-policy-ports.ts` (`embedPolicy = {...} satisfies EmbedPolicyPort` from `@jini-ai/cms/widgets/markers`); `embedPolicy` added to `createHostAdminScope` ports; the 3 Tovu callers (`use-edit-media-panel.hooks.ts`, `MediaEditDialog.hooks.tsx`, `media-content-rules.ts`) and 2 test files pass `policy: embedPolicy`; one stale comment in `features/media/rules.ts` reworded. Message names Jini 6ada1f20c. |
Tovu pre-push hook: "no apps/desktop changes, skipping desktop gates" (no --no-verify used).

## Red / green (S2)
- New tests written first against the OLD code: `embed-policy-port.test.ts` 3 failed (port consulted for a name, port's parse result returned, stylesheet context never requested); the 5 rejection-class cases (disallowed name, event handler, unsafe URL, unsafe style, malformed) and every existing `legacy-rules`/`html-attributes` case (now given `policy: realEmbedPolicy`) were GREEN on old code = characterization of the same `MediaHtmlAttributeRejectionReason` per class.
- Mutations after the change, all restored: `parseAttributes({text}, { styleContext: 'stylesheet' })` -> the inline-context test red (1 failed); `isAllowed...` returns `true` -> 13 failed; `parse...` ignores the policy -> 46 failed. Tovu: dropping `embedPolicy` from `createHostAdminScope` ports -> comments-swap and other scope suites red.
- Fake-hook output test: `edit-media-embed-policy.hooks.test.tsx` (3 tests: real policy no hint; allow-nothing policy names the attribute; event-handler reason kept) through `{ usePorts: () => ports }`.

## Gates (Jini at 6ada1f20c, BASE 51999efa)
- `npx vitest run --maxWorkers=2 --minWorkers=1` in packages/admin: 220 files / 2903 tests green (base 218 / 2892; +11 tests, +2 files (embed-policy-port test, hook test); none removed). S13: 17 `-it(/expect(` lines in the diff are the same lines re-added with the `policy` / `embedPolicy` argument (checked by normalising the added text: `comm -23` prints nothing).
- Root `pnpm typecheck` exit 0; admin `npm run typecheck` 0 errors; `pnpm guard` exit 0, output equals base except the advisory "test-only cross-package imports" 380/256 -> 381/257 (the new test fake imports cms; advisory, not failing); `check:size` and `check:complexity` exit 0; `check-peer-ranges.ts`: compatible; `pnpm check:hooks` exits 1 on the unmodified base too (ui `AssetGridToolbar` `ViewModeToggle::useT`), output byte-identical to base, no new key.
- S3 prints two lines: both are pre-existing `export {..} from` lines in `media/index.ts` with one name added/removed (no new shell). The kept `parseMediaHtmlAttributes` one-call body is not a forwarder: it fixes the inline-attribute context (never passes `styleContext`), pinned by a test. `isAllowedMediaHtmlAttributeName` is a plain delegate kept by the sheet; flagged for the owner (no production caller).
- S4, S5, S6, S11 print nothing. S10 prints one EDITED existing `as unknown as` test line (only the `{ wrapper }` option appended). S8 (50/10/500 vs BASE on the 6 changed source files) prints nothing.
- S7: the only vanished comment lines are the allow-list doc comments of `html-attributes.ts`, reworded in place (header of `isAllowedMediaHtmlAttributeName`: "the host's embed policy lists `name` ... admin keeps no allow-list of its own"; `parseMediaHtmlAttributes` doc: "now reached through the injected `EmbedPolicyPort.parseAttributes`", "the allowlist behind ... (the injected `policy`) is the ONLY path to acceptance"). The server-mirror comment (file header) is unchanged.
- S9: `isAllowedMediaHtmlAttributeName`, `parseMediaHtmlAttributes` `(required, optional = {})`; `useEditMediaPanel(props, { usePorts })` hook object with the real hook as default; test helper `EmbedPolicyScope` is a component.
- api-baseline: only `jini-ai__admin.json` committed (the 11 other baselines `pnpm api:update` rewrites are pre-existing drift, reverted).
- Tovu (linked to Jini 6ada1f20c): `npm run typecheck` exit 0; `apps/admin` `tsc --noEmit` clean; `apps/admin` vitest for `src/features/media`, `src/integrations/jini-admin`, `src/components`: 166 files / 2201 tests green. The FULL apps/admin suite was started and hit the 560 s guard (not completed; killed): not verified. Tovu `check:size`/`check:complexity` fail in both trees on lines this lane does not touch (`apps/website/...`, 40 violation lines); `media-content-rules.ts` `readMediaContent` complexity 10 is "New violation" on the base file too (same body, shifted one line by the import).

## Left / next step
- Nothing left of R2b item 1. Not done and out of this item: `packages/admin/src/comments/PORT.md:92` still says `createMemoryCommentsApi` delegates to cms's `InMemoryCommentRepo` (stale since R2b-2; one-line doc fix). `@jini-ai/cms` stays a devDependency of admin (tests import it).
- Next: re-run the full Tovu admin suite on a runner with more time.

## Sheet deviations
- The sheet names the Tovu file `embed-comment-ports.ts`; no comment binding exists in Tovu, so it is `embed-policy-ports.ts`.
- Tovu callers import the host-owned `embedPolicy` constant instead of receiving it through their `deps` (smallest change; the three callers had no injected slot for it).

## Overlaps with parallel lanes
`scripts/injection-debt.json` (two own keys deleted by hand), `api-baseline/jini-ai__admin.json`, `packages/admin/package.json` (cms lines only).
