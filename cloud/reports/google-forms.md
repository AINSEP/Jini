# google-forms — completed

Implemented approved plan steps 1–5. Branch in both repositories: `cloud/google-forms`.
No main push, force-push, deployment, publication, tag, live Google check, or owner-data access.

## Result

- Shared public provider descriptions drive the admin editor and assistant discovery. Missing, broken and retired providers show unavailable settings while preserving stored selections and drafts. The admin and assistant tests prove an arbitrary fourth provider works without client edits.
- Discovery uses the authorized `/api/admin/v1/workspaces/:workspaceId/forms/_providers` endpoint; the valid existing form slug `providers` remains accessible.
- Added independent hosted collection runtime and assistant plugin subpaths. Runtime id `google-forms`, collection id `google_forms`, config only `url`. Strict exact HTTPS public responder-link allowlist; canonical embed URL; no credentials, vendor APIs or requests during planning.
- Embeds declare `consent: ["functional"]`. The existing shared `allows({consent})` evaluator controls activation. Missing infrastructure stays inert; explicit consent-off delivers an ordinary frame. Withdrawal unloads denied frames and finishes declared-asset cleanup before one reload. Published policy is cached; startup, delayed declaration, stale refresh and repeated-mount races are covered.
- Visible fallback remains: “If this form does not open, open it on Google or contact the site owner.” Its link is the validated public responder URL. Questions and new answers remain in Google, while switching preserves local definitions/history and pending receiver data.
- Only declared frame origins extend the existing report-only header formatter. No Google script origin and no pre-consent header gating. Live responses and publication use the same current metadata; malformed origins are omitted.
- Built and sealed actual runtime artifacts, agent exports and catalog integrity. Tests load the standalone packed runtime and exercise the live widget renderer, static HTML and ZIP preservation.

## Bases, source snapshots and commits

Bases are the current consent tips fetched for this job. All commits below are on `cloud/google-forms`; report-only delivery commits follow these source snapshots and are identified in the final delivery message.

### Jini

Base: `8ff6006f92e7f157c47c74ab6255652cec3b395c`. Verified source snapshot: `47430c951f9b956a4e9c3fd481b8972b0f51a74e`.

```text
6e867974f4f4bef8d8d0e482948611b53eed7af7 docs: record collection provider work in progress
d5f2d853c154327b059b70be42f2342e7b1b7097 feat(forms): discover collection settings and add hosted embed provider
11393a65399a512f6eb6863eedf15f5bed5bedda feat: discover collection settings in form editor
277921a39d0faa20ecc86102d41886825999f113 fix: keep provider discovery isolated from editor drafts
d78f56629f512a3ade6a1ad102cd34154a98bd8f feat(forms): gate declared embeds through shared consent permissions
42001d06983bd4a401285b175013164d3c7bd176 feat(forms): pass host embed delivery policy through resolver
8ee77643e286ecb22e8a83a2228b71fbe6ad6a7d test(forms): verify host-controlled embed consent delivery
c7d94f35938cf102b03bf89f2b2c19c409a0cc7b feat(forms): package hosted collection runtime and assistant guidance
1f95eb9aacb5e448d3c77c3a6b99d7d9cdc39ee4 fix(consent): finish declared asset cleanup before reloading
20e9f02f09a5cd6a9cc65d06bd153305d566e2da test(consent): verify shipped frame permission lifecycle
1038b8fba4b89508f1da334aaf68a86b7b297c3d fix: reserve provider discovery outside form slug paths
d6e2cb8860c038c450ad22c599ff6090c82e9e63 build(forms): seal collection artifacts and extend package verification
47430c951f9b956a4e9c3fd481b8972b0f51a74e build: refresh integrity after the complete package rebuild
```

### Tovu

Base: `4ac832ba984c4ea7f9f9b161d3acf4b2f6ce6f79`. Verified source snapshot: `47e9a6c35697f2002ce9810225e0b5910d191769`.

```text
6b09e149fcec42201aec6ebbef73cb5109040951 feat(forms): share provider discovery with admin and assistant
7f441233b02f7da4e7e086aca59864630053cb5d feat(forms): use published consent mode for embed delivery
5a2e6c5680772b3b2f8c3a766fbc2cae79c237a8 test(forms): cover provider discovery and embed delivery policy
795e5452fd926e9a4bd9e4c1e09d5fe9cc3ca479 feat(forms): select hosted collection guidance and retain receiver boundaries
51aa9017c8d9e91a05adc65edb242ac77daa6b4e fix(forms): wait for published embed delivery policy before rendering
42116e217dad3d2224ace86680f3f540f66366ef feat: carry declared collection frame origins across public delivery
4751455a3986e052615b9b91adfa823721e0685a fix(forms): keep provider discovery separate from form slugs
8540713828b130a4e0f703444af9646d12ee2ff9 test(forms): verify provider listing uses approved load error copy
42fed880c9826c9496bad57ebfbaf3314a335d62 fix(forms): resolve embed policy independently of script discovery
34f8c368dee884d1904b76372d617070c78e76b3 test(forms): preserve latest embed policy across repeated mounts
9012e26f4601a27a78c594654ae4f8bd929aad85 test(forms): preserve hosted embeds through static copies and archives
47e9a6c35697f2002ce9810225e0b5910d191769 test(forms): exercise the live widget renderer in static parity checks
```

## Verification

Commands run in the indicated repository after `source /workspace/.tovu-build/env.sh`. Only focused affected test files were run; no full repository test suite ran. Final builds and checks used the code on this branch.

### Build and type checks

- Jini: `pnpm -r --no-bail build` — passed for the complete workspace rebuild.
- Tovu: `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini` — passed after rebuilding Jini.
- Tovu: `npx tsc -p tsconfig.json --noEmit` — passed after the final rebuild/relink.
- Jini: `pnpm --filter @jini-ai/cms run typecheck` — passed.
- Jini: `pnpm --filter @jini-ai/admin run typecheck` — passed.
- Jini: `pnpm --filter @jini-ai/cookie-consent run typecheck` — passed.
- Jini: `pnpm --filter @jini-ai/agent-plugins run typecheck` — passed.
- Jini: `npm --prefix packages/provider-plugins run build` — passed, including main/charts typechecks and all current runtime artifacts.
- Jini: `pnpm --filter @jini-ai/plugin-catalog run generate` — passed after the complete rebuild; generated digests committed.
- Jini: `node --import tsx scripts/check-plugin-packages.ts` — passed.
- Jini: `node --import tsx scripts/check-agent-plugin-content.ts` — passed.

Initial checks exposed missing local package bodies/links and stale built exports. These were repaired in the workspace without source/lockfile changes. The first recursive build failed while setup and edits were ongoing; no clean unmodified green baseline was captured. Final complete rebuild and Tovu typecheck both passed. Socket/subprocess checks initially needed the execution tool's network permission; their final runs passed without changing tests.

### Jini focused tests

```bash
npm --prefix packages/cms run test -- src/forms/__tests__/provider.test.ts
# 7 passed
pnpm --filter @jini-ai/cms exec vitest run src/forms/__tests__/embed-consent.unit.test.ts
# 2 passed
pnpm --filter @jini-ai/cms exec vitest run src/widgets/__tests__/unit/resolvers-contact-form.unit.test.ts src/widgets/__tests__/unit/resolvers-core-wiring.unit.test.ts
# 28 passed
npm --prefix packages/provider-plugins run test -- src/google-forms/__tests__/provider.test.ts src/formspree/__tests__/provider.test.ts
# 39 passed
pnpm --filter @jini-ai/provider-plugins exec vitest run src/__tests__/artifact.integration.test.ts
# 14 passed, zero skipped in the final full-file run; includes isolated Google installation with both SDK ABIs
npm --prefix packages/admin test -- src/forms/react/__tests__/FormEditorFieldsBody.unit.test.tsx src/forms/react/__tests__/use-form-editor.unit.test.tsx src/forms/__tests__/forms-surface.unit.test.ts src/forms/__tests__/memory-adapter.unit.test.ts
# 65 passed
npm --prefix packages/admin test -- src/forms/react/__tests__/FormEditor.unit.test.tsx src/forms/react/__tests__/html-mode.unit.test.tsx src/forms/react/__tests__/FormEditor.leave-and-focus.unit.test.tsx src/forms/react/__tests__/use-form-editor.branches.unit.test.tsx
# 32 passed
npm --prefix packages/admin test -- src/forms/__tests__/forms-surface.unit.test.ts
# 9 passed after the discovery path correction
pnpm --filter @jini-ai/cookie-consent exec vitest run src/__tests__/frames.unit.test.ts src/__tests__/scripts.unit.test.ts src/__tests__/client-dom.test.ts
# 18 passed
npm --prefix packages/cookie-consent run test -- src/__tests__/bundle.smoke.test.ts
# 8 passed; blocked resource loader proves zero pre-permission requests and once-only activation, then withdrawal
pnpm --filter @jini-ai/plugin-catalog run test
# 65 passed after final generation, including real npm tarball inventory
```

New tests demonstrated failures before their implementation, including provider discovery, embed activation, mixed asset withdrawal and publication races. No test or rule was disabled, weakened or deleted. The browser bundle build remained within both existing 4608-byte gzip budgets (core 4541 bytes, extensions 2050 bytes).

### Tovu focused tests

```bash
node --import tsx apps/website/src/features/forms/__tests__/agent-tools.unit.test.ts
# 3 passed
node --import tsx apps/website/src/server/runtime/composition/__tests__/provider-plugins.unit.test.ts
# 46 passed
node --import tsx apps/website/src/server/inbound/admin-http/routes/forms/__tests__/providers.unit.test.ts
# 6 passed
node --import tsx apps/website/src/server/inbound/public-http/middleware/__tests__/declared-consent.unit.test.ts
# 11 passed
node --import tsx apps/website/src/contracts/core/__tests__/unit/form-provider-security-headers.contract.test.ts
# 2 passed
node --import tsx apps/website/src/features/deployments/static-publish/__tests__/adapter.security-headers.unit.test.ts
# 1 passed
node --import tsx apps/website/src/contracts/core/__tests__/unit/public-theme-resource-policy.contract.test.ts
node --import tsx --experimental-test-module-mocks apps/website/src/features/theme/__tests__/public-resources-lazy.test.ts
node --import tsx apps/website/src/features/deployments/static-publish/__tests__/adapter.provider-errors.unit.test.ts
# 8 passed across these three affected adjacent files
node --import tsx apps/website/src/features/forms/__tests__/form-destination-manifest.test.ts
# 11 passed
node --import tsx apps/website/src/features/site-export/__tests__/hosted-forms-static.unit.test.ts
# 2 passed; actual packaged provider, live widget renderer, static HTML and ZIP
```

Node tests were also invoked directly to verify their actual individual-test counts; earlier `--test` file-only output was not used as the evidence above.

### Complexity and whitespace

All changed production TypeScript files were checked with strict cyclomatic/cognitive ceiling 10, no inline configuration. Exact invocations:

Jini:

```bash
pnpm exec eslint --no-inline-config --no-error-on-unmatched-pattern --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' packages/admin/src/core/ports/forms.ts packages/admin/src/forms/adapters/http.ts packages/admin/src/forms/adapters/memory.ts packages/admin/src/forms/react/components/FormEditorFieldsBody.tsx packages/admin/src/forms/react/components/FormProviderSettings.tsx packages/admin/src/forms/react/hooks/use-form-editor.hooks.ts packages/admin/src/forms/react/pages/FormEditor.tsx packages/cms/src/forms/html-render.ts packages/cms/src/forms/provider.ts packages/cms/src/widgets/resolvers/contact-form.ts packages/cms/src/widgets/resolvers/create-core-resolvers.ts packages/cookie-consent/src/client/dom.ts packages/cookie-consent/src/client/features.ts packages/provider-plugins/src/formspree/provider.ts packages/provider-plugins/src/google-forms/index.ts packages/provider-plugins/src/google-forms/provider.ts scripts/lib/agent-plugin-packages.ts
```

Tovu:

```bash
npx --no-install eslint --no-inline-config --no-error-on-unmatched-pattern --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' apps/website/src/contracts/core/public-page-security-headers.ts apps/website/src/contracts/core/tool-metadata/forms.ts apps/website/src/contracts/headless/site-cookie-consent.ts apps/website/src/features/agent-plugins/bundled-catalog.ts apps/website/src/features/deployments/publish-agent-tools.ts apps/website/src/features/deployments/publish-tool-deps.ts apps/website/src/features/deployments/static-publish/adapter.ts apps/website/src/features/forms/agent-tools.ts apps/website/src/features/forms/tool-registrations.ts apps/website/src/features/theme/public-page-security-headers.ts apps/website/src/server/inbound/admin-http/routes/forms/providers.ts apps/website/src/server/inbound/admin-http/routes/system/publish-site.ts apps/website/src/server/inbound/public-http/http/site/render.ts apps/website/src/server/inbound/public-http/middleware/public-page-security-headers.ts apps/website/src/server/inbound/public-http/middleware/site-cookie-consent.ts apps/website/src/server/routes/types.ts apps/website/src/server/runtime/composition/app.ts apps/website/src/server/runtime/composition/deps.ts apps/website/src/server/runtime/composition/modules/forms-admin.ts apps/website/src/server/runtime/composition/provider-plugins.ts
```

Jini: all 17 changed production files passed. Tovu: all 20 were checked; five errors and six warnings reproduce identically against the exact base source using `git show <base>:<path> | npx --no-install eslint --stdin --stdin-filename <path> --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}'`. No new lint diagnostic. `git diff --check <base>` passed in both repositories.

## Cost and remaining work

No new tables, database reads/writes, polls, availability probes, OAuth, form creation, answer synchronization or vendor requests during plugin planning. Editor discovery adds one in-memory registry-list request per editor query load. Assistant discovery is one in-memory projection per invocation. Public headers now project registered descriptions per response/publication; cost is O(providers × description bytes), no new I/O. Embed policy reads the existing published snapshot. An allowed frame navigates to Google and may load Google-controlled subresources; denied frames issue no navigation.

OPEN: A real published public Google Form still needs anonymous-browser checking, as explicitly excluded from this job. Actual owner publication/access/closed-form settings and live full-document theme pages were not exercised. URL validation and iframe load events cannot prove accessibility. Republish affected static pages before acceptance.

BUG (inherited, listed only): Tovu `publish-agent-tools.ts` has cognitive complexity 13 in `collectPreviewSources`.
BUG (inherited, listed only): Tovu `app.ts` has cyclomatic complexity 11 in both `createRouteDeps` and `createApp`.
BUG (inherited, listed only): Tovu `deps.ts` has cyclomatic/cognitive complexity 21/21 in `composeSiteRouteDeps`.
BUG (inherited, listed only): the legacy `packages/provider-plugins/catalog.json` omits the existing Formspree entry. This job adds its new hosted-provider entry; the authoritative shared plugin catalog includes both providers.

Full repository suites remain for the later integration run, per the job. A pre-existing untracked `packages/plugin-ui-ux-design/` directory was left unchanged and uncommitted.

## Exact changed files

### Jini

- `cloud/reports/google-forms.md`
- `packages/admin/src/core/ports/forms.ts`
- `packages/admin/src/forms/__tests__/forms-surface.unit.test.ts`
- `packages/admin/src/forms/__tests__/memory-adapter.unit.test.ts`
- `packages/admin/src/forms/adapters/http.ts`
- `packages/admin/src/forms/adapters/memory.ts`
- `packages/admin/src/forms/react/__tests__/FormEditorFieldsBody.unit.test.tsx`
- `packages/admin/src/forms/react/__tests__/harness.tsx`
- `packages/admin/src/forms/react/__tests__/use-form-editor.unit.test.tsx`
- `packages/admin/src/forms/react/components/FormEditorFieldsBody.tsx`
- `packages/admin/src/forms/react/components/FormProviderSettings.tsx`
- `packages/admin/src/forms/react/hooks/use-form-editor.hooks.ts`
- `packages/admin/src/forms/react/pages/FormEditor.tsx`
- `packages/agent-plugins/google-forms/plugin.json`
- `packages/agent-plugins/google-forms/skills/google-forms/SKILL.md`
- `packages/agent-plugins/package.json`
- `packages/cms/src/forms/__tests__/embed-consent.unit.test.ts`
- `packages/cms/src/forms/__tests__/provider.test.ts`
- `packages/cms/src/forms/html-render.ts`
- `packages/cms/src/forms/provider.ts`
- `packages/cms/src/widgets/__tests__/unit/resolvers-contact-form.unit.test.ts`
- `packages/cms/src/widgets/resolvers/contact-form.ts`
- `packages/cms/src/widgets/resolvers/create-core-resolvers.ts`
- `packages/cookie-consent/src/__tests__/bundle.smoke.test.ts`
- `packages/cookie-consent/src/__tests__/frames.unit.test.ts`
- `packages/cookie-consent/src/client/dom.ts`
- `packages/cookie-consent/src/client/features.ts`
- `packages/plugin-catalog/__tests__/catalog.test.ts`
- `packages/plugin-catalog/catalog.json`
- `packages/provider-plugins/catalog.json`
- `packages/provider-plugins/package.json`
- `packages/provider-plugins/src/__tests__/artifact.integration.test.ts`
- `packages/provider-plugins/src/formspree/provider.ts`
- `packages/provider-plugins/src/google-forms/__tests__/provider.test.ts`
- `packages/provider-plugins/src/google-forms/index.ts`
- `packages/provider-plugins/src/google-forms/jini.plugin.json`
- `packages/provider-plugins/src/google-forms/provider.ts`
- `scripts/lib/agent-plugin-packages.ts`

### Tovu

- `apps/website/src/contracts/core/__tests__/unit/form-provider-security-headers.contract.test.ts`
- `apps/website/src/contracts/core/public-page-security-headers.ts`
- `apps/website/src/contracts/core/tool-metadata/forms.ts`
- `apps/website/src/contracts/headless/site-cookie-consent.ts`
- `apps/website/src/features/agent-plugins/bundled-catalog.ts`
- `apps/website/src/features/deployments/publish-agent-tools.ts`
- `apps/website/src/features/deployments/publish-tool-deps.ts`
- `apps/website/src/features/deployments/static-publish/__tests__/adapter.security-headers.unit.test.ts`
- `apps/website/src/features/deployments/static-publish/adapter.ts`
- `apps/website/src/features/forms/__tests__/agent-tools.unit.test.ts`
- `apps/website/src/features/forms/__tests__/form-destination-manifest.test.ts`
- `apps/website/src/features/forms/agent-tools.ts`
- `apps/website/src/features/forms/tool-registrations.ts`
- `apps/website/src/features/site-export/__tests__/hosted-forms-static.unit.test.ts`
- `apps/website/src/features/theme/public-page-security-headers.ts`
- `apps/website/src/server/inbound/admin-http/routes/forms/__tests__/providers.unit.test.ts`
- `apps/website/src/server/inbound/admin-http/routes/forms/providers.ts`
- `apps/website/src/server/inbound/admin-http/routes/system/publish-site.ts`
- `apps/website/src/server/inbound/public-http/http/site/render.ts`
- `apps/website/src/server/inbound/public-http/middleware/__tests__/declared-consent.unit.test.ts`
- `apps/website/src/server/inbound/public-http/middleware/public-page-security-headers.ts`
- `apps/website/src/server/inbound/public-http/middleware/site-cookie-consent.ts`
- `apps/website/src/server/routes/types.ts`
- `apps/website/src/server/runtime/composition/__tests__/provider-plugins.unit.test.ts`
- `apps/website/src/server/runtime/composition/app.ts`
- `apps/website/src/server/runtime/composition/deps.ts`
- `apps/website/src/server/runtime/composition/modules/forms-admin.ts`
- `apps/website/src/server/runtime/composition/provider-plugins.ts`
- `cloud/reports/google-forms.md`
