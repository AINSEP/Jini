# Job review-fixes (owner-approved 11-05)
Fix the bugs that a read-only review found on the merged work, and cut the listed excess code. The review read the code and ran nothing, so check each item first; if one is wrong, say so in the report and leave it. Your prompt adds a few items that are not listed here; they count the same.

Work directly on origin/cloud/combine in Tovu and Jini and push there. Owner approved --no-verify for pushes to cloud/combine in Tovu only. Pull before each push; never force-push. Each bug: failing test first, then the smallest fix. Run tests only for what you change; full suites are the next job. Rebuild and relink Jini after changing it, and regenerate the catalog if digests change.
If a fix needs new machinery (a table, a framework, a new option), stop on that item and report it for an owner decision. Do not touch design already decided: scripts declare consent with a `consent` field, no field means the script runs, an outside script with no tag runs with no warning, no page rewriting, one interface, banner is a plugin.

## Consent (Tovu site-cookie-consent.ts unless named)
1. content/agent-plugins/tovu-theme/skills/tovu-theme/SKILL.md:104-106 still teaches data-consent-category and the removed unsafe-eval control. Teach the JSON `consent` declaration instead, matching assistant-content-guidance.ts.
2. :204-205, :252, :264: one failed policy read at boot leaves a rejected snapshot, so the banner and all declared scripts stay gone with no retry. Do not keep a failed read: retry on a later request, at most once per 60 seconds. While it is failing, still send scripts with no `consent` field and withhold scripts that declare one. Also cover siteConsentExportAssets (:225) and siteReceiptAllowsAnalytics. The warning must say what happened in plain words.
3. :237-238, :253-254: on consent-off sites plugin declarations refresh only at boot or publish. A plugin turned on or off must take effect without a restart. Refresh from the plugin change event if one exists, otherwise re-read on the existing 60-second TTL. Also check whether a settings write outside publish that turns consent on leaves a stale "off" snapshot.
4. :200-216: restore the skip for theme-override renders (res.locals.tovuRenderThemeIdOverride), with a test that really goes through the override. Previews must carry no banner or analytics adapters.
5. http/site/render.ts:3640 and :203 here: with no asset hook, a script that declares `consent` becomes a plain tag. Default must withhold it. Live caller: theme-page-preview.ts:231.
6. :216: the Cookie settings link has no style. Give it one from existing tokens. No page scanning.
7. Jini cookie-consent client/runtime.ts:232: guard the reload so a stale page from a shared cache cannot loop; one reload per page policy.
8. routes/site/analytics-ingest.ts:89 and :208 here: PostHog on with consent off sends nothing, because server pageviews are suppressed for a browser client that never loads. Do not suppress when no client will load.
9. Jini cms widgets/html/plugin-export.ts:49,175: stamps a category on live elements nothing reads. Trace whether exports can carry a script or iframe. If yes, make them use the declared route; if no, remove the stamp.
10. :266-269: extension asset does sync disk work per request. Read once and keep it.
11. features/consent/service.ts:164-165: a refresh failure after a successful publish must not report the publish as failed. Warn instead.
12. app.consent-capture.test.ts expects id="jini-consent" on a site with published consent and the HTML omits it, on base too. Find out why: real bug means fix the code; outdated test means say why.

## Media (Tovu routes/site/media-rendition.ts :53, :281, :440-443, :556-584)
13. Public images became `public, no-cache`, so every image request, even a 304, reads the whole post list, reads the bytes and hashes them. Keep the fix: a replaced image must show. Use `public, max-age=60` plus the ETag, answer a matching If-None-Match from stored source data without loading bytes where the data allows, and do no whole-post-list read per image request: reuse a bounded in-process decision of at most 60 seconds per asset, or the smallest equivalent. Gated media stays private, no-store and still 404s the same way. State frequency × payload before and after.

## Commerce, chat protocol, forms, smaller items
14. commerce-http.ts:38, commerce.ts:283: storefront guard runs needsAttention on every /products request. Give the guard a cheap active check; keep status() for admin and tools.
15. commerce-http.ts:24-33: /commerce/return, /commerce/cancel and /commerce/checkout.js are served while commerce is off and shadow a site's own pages. Off must fall through, as /products does.
16. Jini agent-runtime json-line-stream.ts continuePendingJsonLine: a complete frame after a stray incomplete line is dropped with an error. Retry it as a fresh frame as the old code did. Keep the multiline limit.
17. Jini model-discovery.ts:294-297: check that a custom or config-file model, or an empty catalog after a failed probe, with a stored effort still launches. The report says it does. If refused, fix it. Also defs/codex.ts:300-304 with launch.ts:1211: cliParity runs skip validation, so an unadvertised effort reaches Codex and fails there. Give the plain error.
18. Jini bounded-line-stream.ts:2: check whether a CLI can echo a line over the 8 Mi limit with a large attachment, and that the error is plain and pasteable.
19. features/forms/tool-registrations.ts:146-157,324: forms_list_definitions must not return full HTML for every form. Single-form tools keep it.
20. Jini cms forms express/handler.ts:295-313: retry pages carry no attempt token, so a double click stores two submissions. Give them the token.
21. routes/site/forms-submit.ts formFailureProperties: a stale form and attachment-space errors are counted as "internal". Use their own reasons.
22. Jini cms forms submit-service.ts:167: schema check runs before the honeypot discard, so a bot sees a 409 instead of the same accepted response. Discard first.
23. Jini scripts/publish-pending.ts:158-159: --plan and a consistency failure skip the step summary. Write it.
24. Jini agent-plugins lifecycle/automatic-use.ts:141-143: an off plugin returns the full guidance on each repeat load. Record delivery.
25. http/site/render.ts:2411: randomUUID per render makes static exports differ each time for a page with a form. Use a stable id in exports; live pages keep theirs.
26. Jini cms media document-read.ts:52-58: the 50 MiB cap stays (requested). Add a small concurrency bound if none exists, and report the memory cost per read.

## Cut (no behaviour change; check each has no real caller first)
Jini: clampCodexReasoning + GPT-5 helpers in agent-runtime defs/shared.ts; buildAccessApprovalSurface in ui mcp-ui surfaces/access-approval.ts:26-31; approval.ts plan.access batch merge :227-229 if nothing renders it; cookie-consent client index.ts wrappers around boot and bootWithContext; the text/plain + `ran` path in activateInert only if no author uses it and iframe[data-src] authors are checked; consent-dictionary.ts unsafe-eval strings; `attemptToken ?? null` in submission-attempts.ts; check-plugin-packages.ts reaching into packages/plugins for semver; schemaHash on renderFormCollection options.
Tovu: enable-access.ts:60-64,:79 preview details and accessDetails with plugin-runtime/tool-registrations.ts:309,326,336,351 and the contract field; connect-tool.ts:304 onConnected if unused; site branch of browser-analytics-http.ts and PostHog site browserAnalytics, only if item 8 leaves them unused; anonymous off-mode leftovers in readSiteVisitorConsent :147-149; readSiteConsentPolicy options nobody passes; three parallel TTL caches and module WeakMaps in site-cookie-consent.ts collapsed to one where it is plainly safe; formSchemaOptions in render.ts:2399-2401; stale negative selectors in server/__tests__/helpers/default-consent-page.ts:14-15.

Report at cloud/reports/review-fixes.md and in your final message: final shas, each item fixed, wrong, or stopped and why, tests with exact commands, lines removed. General wording in commits and notes. Report every bug you notice, even outside this list, under "Bugs found".
