# Job review-fixes-2 (owner-approved 11-05): last fix round before full tests
A check of review-fixes found these. Check each first; if one is wrong, say so and leave it. Your prompt adds a few items that are not listed here; they count the same. Same working rules as cloud/jobs/review-fixes.md: directly on origin/cloud/combine in both repos, --no-verify for Tovu only, failing test first, focused tests only, pull before each push, never force-push. This is the last round: if an item needs a new mechanism or the same class of problem reappears, stop on it and report it. Do not patch around it.

## Consent: replace the failure handling, do not add to it (Tovu site-cookie-consent.ts)
1. Keep the last good policy. A failed or slow read must never clear it, and a late success must still land. Drop the 250 ms race on refreshes: pages always serve from the last good snapshot while a background refresh runs, at most once per 60 seconds. Only when there has never been a good snapshot may a page wait, and that wait is bounded and does not fail the read. The first read at boot must not be cut off by boot seeders (deps.siteConsentReady). Change the test that locks in the old behaviour (declared-consent.unit.test.ts:142) and say why. Remove state this makes unused. Expect fewer lines than now.
2. Static export with no good policy yet ships pages with no banner silently. Keep publishing, and put a plain warning in the publish result.
3. Reading extensions.min.js and the client file at mount: a missing file must warn and disable that route, not stop the app.
4. Move the inline style in siteConsentDocumentAssets to the banner CSS.

## Consent on static themes (the largest item)
5. app.consent-capture.test.ts was moved to activeThemeId 'none', hiding a gap: no static-tier path receives consent assets (pages.ts:834-904 finishStaticTierDocument, http/site/render.ts:3528-3540 renderStaticTierHomePage, pages.ts:2628). With consent published on a static theme such as tovu-theme or tovu-starter there is no banner, no withdrawal link, no client, and declared optional scripts never load, while settings say on. Prove it with a failing test through a real static theme. Fix without any page rewriting or response scanning (owner decision): the theme carries one small loading tag in its own HTML, which loads the same client and uses the existing context route. Add it to shipped static themes in content/themes/static, teach it in the tovu-theme skill, and have consent readiness warn in the admin when consent is on and the active theme lacks it. Check static export too. Restore a test that covers a static theme. If this needs more than a small tag and existing routes, stop on it and report what it would take.

## Forms and providers
6. An invalid provider link must not save as success (earlier item 29). Check it at the save, in the editor and the tool, with plain words; the smallest dependency that lets the save ask the provider is approved.
7. provider-plugins.ts: a provider that fails its first apply at boot disappears from the registry, because the unconditional registry build after boot was removed. It must show as named and unavailable, per item 34, and recover on a later success.

## Small
8. apply-connect-defaults.ts:40-42: the why-comment for CONNECT_DEFAULTS_ACTOR now sits on the wrong constant.
9. Jini json-line-stream.ts:58: after an over-budget candidate, a continuation line that is itself valid JSON is emitted as a message with no error. Fix if real.
10. Confirm these removed assertions exist in another form, or restore them: "the rejected save must not have created a row", and the allowedToolNames and write-list assertions on the saved record in the external-mcp tests.
11. Trim: interruptedConnectAccess and the partially-connected status if plain error text does the job.

List, do not fix: media evidence eviction above 256 hot assets; document read admission having no timeout.

Report at cloud/reports/review-fixes-2.md and in your final message: final shas, each item fixed, wrong or stopped and why, tests with exact commands, lines added and removed in production code separately from tests. General wording in commits and notes. Report every bug you notice under "Bugs found".
