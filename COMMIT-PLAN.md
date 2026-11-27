# Round 2 w3b-ext-crp — Jini handoff

Base HEAD: `fa8e4956132924fa72dfdfd1bd8c20a39f7a2d89`. Source reads: Tovu `c0f1068a59e78a39dfdbbd3760b2c8aac996f794` via read-only git show. Programmer guidance loaded from `/Users/la/Programming/Tovu/AI-Dev-Shop/agents/programmer/skills.md`; the explicit dispatch controls scope and overrides broader workflow rules.

Working tree only: no commits, fetches, pushes, subagents, MCP discovery, installs, tests, builds, typechecks or linters. Witness files were written before their production modules. Mutations below are instructions for Opus; none has been executed here. Changesets use minor per the approved fixed-group override X5. No existing tests were removed or weakened.

## Stops and LEFT

- **CRP-15.J STOP:** its required CRP-11.J `featuredImageView` projection is absent from `packages/cms/src/public-http/http/site/render/template-render-data.ts` (file absent; the named symbol is absent in the render area). Implementing a replacement would exceed this sheet. No CRP-15 files/tests/exports added.
- **CRP-16.J LEFT dependent:** needs that cover projection and CRP-15 media context.
- **CRP-18.J LEFT dependent:** needs CRP-15 cover projection and CRP-16 previews.
- **CRP-19.J LEFT dependent:** needs CRP-18 static/template finishing.
- **CRP-20.J LEFT dependent:** needs CRP-19 `withPageShellChoice`.
- **CRP-24.J PARTIAL / raw step STOP:** the access-evidence leaf is written. The raw rendition/original specs cannot satisfy the fixed universal requirement while reusing the named owner: `media/original-response.ts:3` imports `media-service.ts`, whose `:62` imports `node:crypto`; `media/content-type-sniffer.ts:181` uses `Buffer` on the actual sniff path. A new response-policy split or additional port is not named in this sheet. The raw draft and its witness were removed, with no public raw export added. `evaluate-etag-before-access` and the original-range witness remain LEFT with that step.
- All **CRP-13.T…CRP-30.T** are LEFT to the Tovu builder. No REJECT or NEEDS-OPUS Jini sheet is in this set. The publish-credentials input has no Jini implementation sheet here and is untouched. The H2 actor migration belongs to arch, outside these ext-crp sheets.

## Design commit units, in sheet order

These are proposed coordinator commit units, not commits made by this job. CRP-24 must be labeled partial.

### 1. CRP-13.J — implementation written, untested

Files:

- `packages/cookie-consent/src/site/http.ts` (new)
- `packages/cookie-consent/src/site/__tests__/http.test.ts` (new; 4 tests)
- `packages/cookie-consent/package.json` (exports, runtime classifications, isolation mapping)
- `.changeset/crp-13-consent-http.md`

Named mutation: `skip-active-receipt-read`.

Tovu consumes: `@jini-ai/cookie-consent/site/http`.

### 2. CRP-14.J — implementation written, untested

Files:

- `packages/cms/src/public-http/http/site/render/content-html.ts` (new)
- `packages/cms/src/public-http/http/site/render/page-body.ts` (new)
- `packages/cms/src/public-http/http/site/render/__tests__/content-html.test.ts` (new; 1 tests)
- `packages/cms/src/public-http/http/site/render/__tests__/page-body.test.ts` (new; 2 tests)
- `packages/cms/package.json` (exports, runtime classifications, isolation mapping)
- `.changeset/crp-14-content-html.md`

Named mutations: `dispatch-inherited-component-id`, `reuse-resolved-header-across-occurrences`.

Tovu consumes: `@jini-ai/cms/public-http/http/site/render/content-html`, `@jini-ai/cms/public-http/http/site/render/page-body`.

### 3. CRP-17.J — implementation written, untested

Files:

- `packages/cms/src/public-http/routes/site/pages/response.ts` (new)
- `packages/cms/src/public-http/routes/site/pages/__tests__/response.test.ts` (new; 2 tests)
- `packages/cms/package.json` (exports, runtime classifications, isolation mapping)
- `.changeset/crp-17-page-response.md`

Named mutation: `run-document-hooks-on-json-batch`.

Tovu consumes: `@jini-ai/cms/public-http/routes/site/pages/response`.

### 4. CRP-21.J — implementation written, untested

Files:

- `packages/cms/src/public-http/routes/site/member-pages.ts` (new)
- `packages/cms/src/public-http/routes/site/products.ts` (new)
- `packages/cms/src/public-http/routes/site/__tests__/member-pages.test.ts` (new; 1 tests)
- `packages/cms/src/public-http/routes/site/__tests__/products.test.ts` (new; 1 tests)
- `packages/cms/package.json` (exports, runtime classifications)
- `.changeset/crp-21-member-storefront.md`

Named mutations: `defer-private-header-until-after-session`, `search-bounded-grid-for-detail`.

Tovu consumes: `@jini-ai/cms/public-http/routes/site/member-pages`, `@jini-ai/cms/public-http/routes/site/products`.

### 5. CRP-22.J — implementation written, untested

Files:

- `packages/user-management/src/member-login/oidc-request.ts` (new)
- `packages/user-management/src/member-login/unlink-identity.ts` (new)
- `packages/user-management/src/member-login/__tests__/oidc-request.test.ts` (new; 2 tests)
- `packages/user-management/src/member-login/__tests__/unlink-identity.test.ts` (new; 2 tests)
- `packages/user-management/package.json` (exports, runtime classifications, isolation mapping)
- `.changeset/crp-22-member-oidc.md`

Named mutations: `send-challenge-before-limits`, `use-pre-lock-session`.

Tovu consumes: `@jini-ai/user-management/member-login/oidc-request`, `@jini-ai/user-management/member-login/unlink-identity`.

### 6. CRP-23.J — implementation written, untested

Files:

- `packages/cms/src/public-http/routes/plugin-contributions.ts` (new)
- `packages/cms/src/public-http/routes/__tests__/plugin-contributions.test.ts` (new; 2 tests)
- `packages/cms/package.json` (exports, runtime classifications)
- `.changeset/crp-23-live-plugin-routes.md`

Named mutation: `skip-post-handler-generation-check`.

Tovu consumes: `@jini-ai/cms/public-http/routes/plugin-contributions`.

### 7. CRP-24.J — access leaf only (PARTIAL)

Files:

- `packages/cms/src/media/site/rendition-access.ts` (new)
- `packages/cms/src/media/site/__tests__/rendition-access.test.ts` (new; 1 tests)
- `packages/cms/package.json` (exports, runtime classifications, isolation mapping)
- `.changeset/crp-24-public-media.md`

Named mutation: `ignore-retired-slug-evidence`.

Tovu consumes: `@jini-ai/cms/media/site/rendition-access`.

### 8. CRP-25.J — implementation written, untested

Files:

- `packages/commerce/src/http/purchase.ts` (new)
- `packages/commerce/src/http/__tests__/purchase.test.ts` (new; 2 tests)
- `packages/commerce/package.json` (exports, runtime classifications)
- `.changeset/crp-25-purchase-http.md`

Named mutations: `activate-before-origin`, `forward-entire-payment-view-on-read`.

Tovu consumes: `@jini-ai/commerce/http/purchase`.

### 9. CRP-26.J — implementation written, untested

Files:

- `packages/cms/src/admin-http/routes/external-mcp/oauth.ts` (new)
- `packages/cms/src/admin-http/routes/external-mcp/probe.ts` (new)
- `packages/cms/src/admin-http/routes/external-mcp/__tests__/oauth.test.ts` (new; 3 tests)
- `packages/cms/src/admin-http/routes/external-mcp/__tests__/probe.test.ts` (new; 1 tests)
- `packages/cms/package.json` (exports, runtime classifications)
- `.changeset/crp-26-external-mcp-http.md`

Named mutations: `begin-shared-connect-before-session`, `probe-before-authorization`.

Tovu consumes: `@jini-ai/cms/admin-http/routes/external-mcp/oauth`, `@jini-ai/cms/admin-http/routes/external-mcp/probe`.

### 10. CRP-27.J — implementation written, untested

Files:

- `packages/cms/src/admin-http/routes/plugins/install.ts` (new)
- `packages/cms/src/admin-http/routes/plugins/__tests__/install.test.ts` (new; 2 tests)
- `packages/cms/package.json` (exports, runtime classifications)
- `.changeset/crp-27-plugin-install.md`

Named mutation: `read-zip-before-digest-validation`.

Tovu consumes: `@jini-ai/cms/admin-http/routes/plugins/install`.

### 11. CRP-28.J — implementation written, untested

Files:

- `packages/cms/src/admin-http/routes/publish-content/peer-transport.ts` (existing module extended; pull unchanged)
- `packages/cms/src/admin-http/routes/publish-content/__tests__/peer-transport.test.ts` (extended; static test count 7 → 9)
- `packages/cms/package.json` (exports, runtime classifications)
- `.changeset/crp-28-peer-push.md`

Named mutation: `open-peer-before-overwrite-admission`.

Tovu consumes: `@jini-ai/cms/admin-http/routes/publish-content/peer-transport`.

### 12. CRP-29.J — implementation written, untested

Files:

- `packages/cms/src/admin-http/routes/settings/events.ts` (new)
- `packages/cms/src/admin-http/routes/settings/__tests__/events.test.ts` (new; 3 tests)
- `packages/cms/package.json` (exports, runtime classifications)
- `.changeset/crp-29-settings-stream.md`

Named mutation: `emit-ledger-head`.

Tovu consumes: `@jini-ai/cms/admin-http/routes/settings/events`.

### 13. CRP-30.J — implementation written, untested

Files:

- `packages/cms/src/admin-http/routes/system/publish-site/trigger.ts` (new)
- `packages/cms/src/admin-http/routes/system/publish-site/destinations.ts` (new)
- `packages/cms/src/admin-http/routes/system/publish-site/__tests__/trigger.test.ts` (new; 1 tests)
- `packages/cms/src/admin-http/routes/system/publish-site/__tests__/destinations.test.ts` (new; 1 tests)
- `packages/cms/package.json` (exports, runtime classifications)
- `.changeset/crp-30-publish-site.md`

Named mutations: `start-before-consent-check`, `list-peers-before-grant`.

Tovu consumes: `@jini-ai/cms/admin-http/routes/system/publish-site/trigger`, `@jini-ai/cms/admin-http/routes/system/publish-site/destinations`.

## Binding details for the Tovu half

- 13: bind lazy plugin enumeration, snapshot readiness, policy/receipt reads and clock. Keep GET outside collectorDecision, rate-key derivation and raw parser in Tovu. `analyticsProof` is synchronous; host keeps consent-before-cookie capture.
- 14: bind one `createContentHtmlRenderer` instance with the existing hosts/taxonomy attributes. Supply a function producing a fresh marker token per render. Widget calls take `{ ir }`. Bind `postAuthorForHeader` for page-body.
- 17: bind all lazy visitor/cache and finalization ports. Apply Vary/Cache-Control/html type before awaiting, then override to JSON for `contentType: "json"`. Listing batches bypass document hooks.
- 21: specs are `memberPageRoute`, `storefrontProductsRoute`, `storefrontProductRoute`; product ports are `readCatalog`, `findProduct`, `renderPage` (null means host already handled), `decorateCheckout`. Preserve live member cookies, host markup and real point lookup.
- 22: bind LoginContext before lazy binding-cookie/query reads, delivery refusal before sealing/mail; retain raw specs/cookies/analytics in Tovu. Bind both readCurrent calls to the same session owner and all transaction effects to the same kernel.
- 23: bind snapshot identity and durable activation before/after handler; adapt tagged empty/JSON replies without adding success no-store to refusal replies.
- 24 partial: share `mediaAccessEvidence.getCache` and write-owner invalidation, bind fresh entitlement only on gated reads. No raw-route subpath is available.
- 25: expose only each route's action. `resolveCommerce` is the synchronous presence decision over the request's selected runtime; remaining ports close over that same runtime/config snapshot. Raw return/cancel results carry `{status, html}`; host writes no-store/html, including invalid IDs.
- 26: keep limiter/browser-session/workspace/header pre-gates in Tovu. Browser factory is `createExternalMcpBrowserSignInRoute({path})`; bind device refusal copy and cookie. Keep host-specific error classification.
- 27: keep ZIP media/parser policy in the lazy readZipUpload port and host class/telemetry catch. No eager bodyParsers on the mount. Normal input/availability refusals return replies.
- 28: plan/confirm/execute are added to existing peer-transport. Keep live-site/workspace preflight, throwing overwrite session port, credentials and error writer in Tovu. Pull remains unchanged.
- 29: bind early writeHead before ledger read and host namespace/preview policy. onClose registers the same close with request and response. Timer handles are cleared once.
- 30: typed factories are `createPublishTriggerRoute({deps})` and `createPublishDestinationsRoute({deps})`; factory arguments infer the generic collaborator types, actual handler deps are supplied by the mount. `readConfig` may carry registry and config together as its generic config value; bind plan/start projections to that value so no second load occurs. Consent refusal must be explicit, never undefined for unavailable readiness. The busy snapshot is read once, with no await before synchronous start. Destination peer capability must be request-bound through requestDeps.

## Verification and API baselines

All changes remain **UNTESTED** by explicit instruction. Opus must run the named witnesses, apply/restore the mutations, run affected parity/package gates, and regenerate/check:

- `api-baseline/jini-ai__cms.json`
- `api-baseline/jini-ai__commerce.json`
- `api-baseline/jini-ai__cookie-consent.json`
- `api-baseline/jini-ai__user-management.json`

No baseline hashes were hand-authored. No build/install/typecheck/lint command ran. Static review covered the authored source, witnesses, tracked diff and package metadata. No claims of passing gates or mutation kills are made.

## Review deletions / scope cleanup

Only code authored in this run was removed:

- CRP-24 raw draft `packages/cms/src/public-http/routes/site/media-rendition.ts` and its new `__tests__/media-rendition.test.ts`, plus their new metadata rows: removed on the universal prerequisite stop. The tests are LEFT, not passed or replaced by the access test.
- Initial private `PurchaseAdmissionDeps` / `PurchaseWriteDeps` aliases were removed; the named admission API owns the structural port types.
- A duplicate post-upload digest type check was removed in favor of the required pre-upload discriminated proof.
- Initial CMS isolation rows inventing `server`/`render` domains were removed; new mappings use existing presentation/media owners where applicable.

No pre-existing production files or tests were deleted. No Tovu file, theme, credential route, migration, dependency manifest beyond the four package export manifests, or .git state was changed.

Static test inventory: **33 added test cases** across 17 new witness files and one extended witness file. No tests run.
