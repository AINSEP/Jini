Software Architect(Direct): **P4 is not yet safe as a deletion-only change.** The replacement covers most runtime uses, but the agreed save-time conversion path is missing, and several consumers still depend on legacy APIs.

**Goal**

Remove `@jini-ai/cms/consent*` and its request-time gate, make `@jini-ai/cookie-consent` the sole engine, and preserve saved settings, receipts, previews, analytics controls, and static export.

**Findings**

Inspected Tovu `2ff3daf05` and Jini `merge-1029` at `90ce35d53`. Read todos item 6 and the [10-26 decision report](/Users/la/Programming/Tovu/ADS-memory/.local-artifacts/swarm-consensus/runs/2026-10-26-consent-redesign-consensus-report.md). Graph tools were unavailable; findings use current source searches and reads.

Below, paths are relative to `apps/website/src` in **prov2-tovu**, unless marked **Jini**. All **13 production files importing the old module** are mapped:

| Importer / caller | Current dependency → replacement |
|---|---|
| [middleware/site-consent.ts:8](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/public-http/middleware/site-consent.ts:8) | `isPublicPage`, `registerConsentHttp`, config/HTTP types, receipt factories → existing `applySiteCookieConsent`. Called by `composition/app.ts:1929`; commerce test helper also selects it. |
| [composition/deps.ts:24](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/deps.ts:24) | `readRequestAnalyticsProof`, `allowsAnalyticsProof` → existing `bindCookieConsentAnalyticsGate`, `readSiteAnalyticsProof`, `siteReceiptAllowsAnalytics`. |
| [composition/analytics-providers.ts:3](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/analytics-providers.ts:3) | Legacy proof reader → existing `readSiteVisitorConsent`; `analyticsProviderRouteDeps` is mounted by `app.ts:2486`. Preserve the full-analytics-only rule. |
| [composition/browser-analytics-http.ts:4](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/browser-analytics-http.ts:4) | Legacy browser mode reader → remove public-site bridge delivery; plugin collectors already use `/_consent/p/<id>`. Preserve session + operator-setting checks for admin delivery. |
| [composition/browser-analytics.ts:3](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/browser-analytics.ts:3) | `captureConsentHtml` serves admin analytics, called by `app.ts:1948`. Needs generic HTML capture, independently of visitor consent. |
| [composition/site-consent.ts:7](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/site-consent.ts:7) | Receipt health → identical existing export from `cookie-consent/node`. Also always inject the replacement preview renderer. |
| [features/consent/readiness.ts:2](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/consent/readiness.ts:2) | Categories/config + `gateConsentHtml`; `consentDryRun` feeds service readiness/preview. **Gap:** replacement preview inserts a banner but creates no legacy inventory. |
| [features/consent/validation.ts:2](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/consent/validation.ts:2) | CSS compiler + `consentPolicyHref` → existing `cookie-consent/render` compiler + `safeHref`. Used by service, policy reads, and assistant settings tools. |
| [features/consent/service.ts:2](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/consent/service.ts:2) | Config, receipt health, categories, expiry, CSS limits/selectors → existing Tovu settings type and replacement exports. Remove coexistence branches; replace obsolete fixed-selector guidance. |
| [features/consent/revisions.ts:2](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/consent/revisions.ts:2) | Config type → existing `SiteConsentSettings`; retain revision JSON unchanged. |
| [features/analytics/contracts.ts:3](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/analytics/contracts.ts:3) | `ConsentAnalyticsProof` → move its two-field contract to Jini cookie-consent. |
| [public-http/visitor-analytics.ts:2](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/public-http/visitor-analytics.ts:2) | Same proof type → replacement contract; retain admission and delivery recheck. |
| [features/forms/analytics-provenance.ts:2](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/forms/analytics-provenance.ts:2) | Same proof type → replacement contract; retain evidence attached to accepted submissions. |

Additional callers and cleanup surfaces:

- Visitor gates reach member registration/sign-in (`routes/members/{deps,analytics,password-sign-in,sign-in,oidc-start,oidc-callback}.ts`), plus `routes/site/{analytics-ingest,pages,search,comments-submit,newsletter-confirm,forms-submit}.ts`. Detached delivery rechecks also run in `composition/modules/forms.ts:59` and `site-assistant.ts:670`.
- Service methods reach admin consent routes through `routes/consent/routes.ts:13`, assistant tools through `features/consent/tool-registrations.ts:43`, and static deployment through `service.ts:166`.
- Replacement middleware still imports policy/origin/constants from old `site-consent.ts:33`. Preserve those helpers and `createPrivacyPageCheck`; delete the old lifecycle around them.
- `features/consent/host.ts:12` only supplies old HTTP ports. `settings-link.ts:8` retains legacy opener detection; remove that branch.
- Seven test files import old APIs: middleware `site-consent.test.ts:10`, `site-consent-policy.unit.test.ts:5`, `site-consent-metadata.unit.test.ts:5`; plugin `plugin-embed-render.test.ts:99`; theme `template-render.canary.test.ts:315`; consent `settings-link.test.ts:5`, `unit/config.unit.test.ts:5`. The development journey also imports the old config type at `consent-eval.journey.ts:4`.
- **Jini:** `cookie-consent/src/__tests__/cms-resource-release.integration.test.ts:8` still manufactures inert resources with the old gate. Its alias is in `vitest.config.ts:7`; this is the only external code dependency on the legacy subtree.
- **Coverage gap:** [new client DOM activation](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cookie-consent/src/client/dom.ts:49) consumes inert markup; it does not convert executable labelled scripts or ordinary iframe sources. No agreed save-time converter was found.

**Design — smallest**

Reuse the existing package and Tovu adapter. Remove the engine selector and fallback; absent region resolvers mean strict policy. Keep banner defaults OFF, saved owner choices, revision IDs, receipt directory, and existing authorization.

Complete the missing P3 conversion prerequisite before deletion: generic, idempotent authoring conversion in Jini CMS; Tovu injects it into existing save/import owners. Tracker signatures come from plugins. Unknown owner code remains trusted and explicitly reported; the replacement does not promise the old blanket resource/CSP policing.

Move the existing bounded `captureHtml` helper to `@jini-ai/http-kit/middleware` for public banner insertion and admin analytics. Preserve its explanatory comments; do not build another capture implementation.

**Steps — ordered, files**

1. **RED contracts first:** extend existing cookie-consent, middleware, analytics, consent-service, and authoring suites for the missing behaviors below.
2. **Finish P3 prerequisite:** add Jini CMS authoring conversion; wire Tovu `features/pages/html-document-store.ts:406/:556` and HTML theme save/import paths around `theme-files.ts:849`. Convert existing published inputs through revision-preserving owners before cutover; prove coverage of generated embeds too.
3. **Decouple shared contracts:** update the 13 importers above. Use Tovu’s existing settings type; add only the minimal analytics-proof type to Jini’s contract. Reuse replacement renderer/policy/node exports.
4. **Repair diagnostics:** update `readiness.ts`, `service.ts`, and composition binding. Inventory actual inert markup/conversion diagnostics; retain limits, redaction, truncation, and failure reporting. Update assistant explanations and admin wording; never substitute an empty inventory for proof.
5. **Rewire runtime:** update `composition/{site-cookie-consent,deps,analytics-providers,app}.ts`, `server/routes/types.ts`, `settings-link.ts`, and commerce fixtures. Always select replacement gates; remove `TOVU_CONSENT_ENGINE`, legacy HTTP ports, and site analytics bridge injection.
6. **Preserve admin telemetry:** extract capture into Jini HTTP kit; update `browser-analytics.ts`. Remove the site branch from `browser-analytics-http.ts` and site revision polling; retain admin transport and its operator consent.
7. **P4 deletion commit:** delete Jini `packages/cms/src/consent/**`; remove four exports, entry/layer metadata, stale peer hint, and `knip.json` entries. Replace the cross-engine test with independent authoring→client tests, then remove cookie-consent’s CMS test alias/dev dependency.
8. Update affected tests, journey types, consent README, and package locks after publishing the compatible Jini release. Verify no old imports remain before releasing Tovu.

**Dependencies and size**

- **Keep `parse5`:** Tovu still uses it for forms, pages, widgets, themes, exports, email, inspection, and WebMCP. Jini CMS still uses it at `navigation/node/index.ts:5`, `widgets/html/server-fragment.ts:3`, and `forms/html/html-authoring.ts:4`.
- Keep `hast-util-from-parse5`, `express`, and other shared dependencies. `mmdb-lib` and `posthog-js` are already absent from Tovu’s root manifest. Vendor packaging changes are outside P4.
- Remove `@jini-ai/cms` from cookie-consent’s **devDependencies** once its cross-engine test is replaced. **No runtime package removal is justified.**
- Gross old production deletion: **15 TypeScript files, 2,314 lines, 153,649 bytes ≈150 KiB**. Net savings depend on retained helpers/conversion. Installed and bundled savings require later measurement.
- Existing replacement client: **10,278 bytes raw / 4,553 bytes gzip**, measured from existing artifacts without rebuilding; above the debate’s ~3 KB target.

**Tests — planned, not run**

- RED: default composition selects the replacement without an environment flag; no legacy public endpoint, consent CSP, or reload-on-choice path remains.
- RED: save/import→published page keeps labelled scripts, tracker fixtures, and optional embeds inert until grant; preserves JSON-LD, authored order, metadata, and unknown-category denial.
- DI fakes: clock, IDs, receipt store, delayed adapter, failing writer, region resolver, and plugin HTTP handler. Verify immediate denial, delayed-grant withdrawal, policy expiry, forged/retired proof rejection, and GPC/DNT.
- Preserve admin telemetry independence, preview/audit exclusions, footer deduplication, stream/overflow handling, cache headers, receipt failures, and static local-evidence behavior.
- Later cloud verification: affected Jini/Tovu suites, type/package checks, and network evidence on isolated live/static fixtures.

**Risks**

- Deleting before conversion lands can release previously gated content. Banner OFF lowers urgency; it does not establish parity.
- Old cookies must never become new grants; retain existing expiry behavior and immutable receipts. Rollback restores the compatible code/package set and content revisions.
- Retaining **admin-only** `/_jini/browser-analytics` is a deliberate limit on the debate’s broader endpoint-removal wording; deleting it now would break admin telemetry.

**Out of scope**

New consent engine, vendor SDK work, geo downloads, database receipt adapter, schema changes, arbitrary-code sandboxing, and full admin analytics redesign. Agent-plugin additions, if needed later, use `@jini-ai/agent-plugins` subpaths.

**Cost and estimate**

No new polls or per-page scans. Conversion adds **one bounded payload transform per save**; existing-content conversion costs **one content read × payload size, plus one revisioned write per changed item**. Existing live delivery reads policy twice per eligible page; detached analytics delivery reads one policy plus one receipt.

Estimate: **2–3 engineering days for P4 rewiring/removal**, plus **2–3 days for the missing conversion/migration prerequisite**. Keep new or changed functions ≤10 complexity; preserve “why” comments. No files edited, tests/builds/servers run, or localhost accessed.