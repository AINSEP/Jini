# plugins-anywhere — implementation complete

Completed 2026-11-06 within the two-hour cap. Focused validation has the pre-existing exceptions listed below; no full test suites, deployment, publication, merge, force push or main-branch push.

## Branches and implementation SHAs

Both repos use only `cloud/plugins-anywhere` from the specified `origin/cloud/combine` bases. Implementation SHAs below precede this final report-only commit.

| Repository | Base SHA | Implementation SHA |
| --- | --- | --- |
| Jini | `01ff07e895d1f48a012f48b33ceb4ee5527c3358` | `3a470346d27256b43999b95bb3a609ab4b8c1269` |
| Tovu | `542635a0ef1d904395a6ddc2aaa8d23808a14dcf` | `303e0179f7f39cf89e5560319994aeb2d262154e` |

Pushed implementation/progress commits:

Jini:
```text
4be58a9d7 docs: record portable plugins job in progress
291a22004 feat: make bundled agent plugin metadata portable
dbe650dfc fix: preserve compatibility and complete portable plugin guidance
3a470346d fix: retain nullish legacy MCP fallback behavior
```

Tovu:
```text
ff0758863 docs: record portable plugins job in progress
a7e7f349e refactor: consume portable agent plugin metadata and host overlays
303e0179f test: verify host guidance through portable plugin delivery
```

## Job items

1. **Manifest migration:** all 34 bundled Jini agent manifests and both Tovu-owned manifests use `extensions.jini`; auth/default-tool metadata uses neutral keys. Stable publisher identities remain unchanged. Each changed plugin payload advances its independent patch version. The existing catalog generator was used after the final payload edits, and a standard package patch changeset covers agent-plugins/catalog.
2. **Shared parsing:** Jini owns typed, validated presentation, host signals/advice, cards/credential cards, MCP auth/defaults/token-auth/tool-renames, identity and existing export metadata. Neutral declarations take precedence; malformed canonical fields are not bypassed using legacy values. Invalid advisory metadata warns without boot refusal. Legacy inline MCP grants retain their existing behavior and cannot supply reviewed read trust.
3. **Tovu readers:** connection/default-grant/federation, metadata/cards, assistant keywords, identity/exports/provider links and other feature readers use Jini parsing. Member-login and DNS readers also use the shared selector. Admin documentation comments name the canonical key. Desktop staging already copies unchanged bytes: no production reader exists in stage-payload-lib.ts and no stage-payload-lib.cjs exists; its affected test now reads shared metadata. The executable site-plugin format's explicit Tovu namespace is a separate contract and stays unchanged.
4. **Skills/overlays:** bundled skills, references and descriptions use capabilities for host operations. Exact Tovu tool instructions remain in Tovu overlays, with no production tool-name mapping table. Actual activation/registry/executor tests prove tools-first pointers, gated tool output and explicit injected guidance for 23 plugins, including host rules preceding portable skills, reserved identifiers and frozen credential labels.
5. **Second-host proof:** the public Jini lifecycle loads every bundled plugin unchanged in a fake host named Another Studio. All 34 cases verify identity, declared MCP settings and every skill/reference without Tovu host wording or host-only helper names. The test imports no Tovu application code. This proves portable loading, not every executable adapter operating without host wiring.

## Compatibility period

Legacy `extensions.tovu` and prefixed MCP aliases are supported through **at least 2027-05-06**. Removal requires an explicit future release decision; no clock-based refusal exists. New keys win. Installed older copies, older site payloads and customized legacy plugins continue working without user action. Diagnostics are returned by parsers, forwarded through lifecycle onEvent, and surfaced by the Tovu installed-MCP reader. The new canonical key never causes a customized older copy to lose its original capabilities or metadata.

## What remains specific to Tovu

- Tovu-owned theme/product-help plugins, overlays, assistant tool names, executable site-plugin identity and product host wiring remain in Tovu.
- Some bundled executable adapters still encode existing host contracts: Cloudflare form resource names, TOVU_FORMS/TOVU_FORMS_SECRET bindings, `/_tovu/*` routes/CSS markers; Google OAuth/Picker TOVU_* bindings and `_tovu_submission_id`/`_tovu_submitted_at` columns; Supabase token-import/retired environment aliases; Fly's exact TOVU_RUNTIME_MODE preboot advice; and host-tool keyword metadata.
- Existing credentials/storage/wire contracts are preserved: `Tovu Mail — Resend API`, `Tovu Search — Meilisearch`, GitHub `.tovu/managed-files.json` and deployment identity strings, S3 tracking/object names/diagnostics, and `.tovu.zip` share-key format.
- Contribution filenames still use the existing `tovu-*.json` contracts (admin-surfaces, agent-tools, connections, consent, credential-schemes, deploy-configs/ops/targets, form-destinations, login-providers, mail-adapters, object-stores, search-providers and source-control). Another host must implement/wire the corresponding Jini contribution/capability ports; those runtime integrations are not automatically supplied by portable manifest loading. Open Marketing itself was not changed or end-to-end tested in this job.
- Stable `tovu/<id>` publisher identities, author attributions, LICENSE/NOTICE and upstream provenance remain for compatibility/licensing. These names are not Tovu imports. No session-specific names were introduced into delivered skills; upstream attribution/revision notes remain where appropriate.

## Bugs found

- **Fixed:** Tovu readers ignored neutral manifests and bypassed the shared parser, including DNS resolver declarations and member-login identity pinning.
- **Fixed:** neutral MCP metadata required a host adapter; Jini now normalizes and validates it with compatibility aliases.
- **Fixed:** a host's configured namespace hid portable bundled identity/metadata; canonical metadata now loads for another host.
- **Fixed during implementation:** creating a canonical extension when customizing a legacy plugin could discard capabilities/cards/MCP/presentation; a failing regression now verifies preservation.
- **Fixed during implementation:** custom-host migration could quarantine a package because of unrelated malformed legacy metadata; original and new precedence regressions now pass.
- **Fixed during implementation:** legacy null auth/default aliases stopped falling back to inline declarations; legacy nullish behavior is restored while canonical null still fails validation.
- **Fixed during implementation:** MCP compatibility warnings were discarded by the installed-MCP readers; actual host warning delivery is tested.
- **Fixed during implementation:** metadata normalization initially dropped valid keyword siblings alongside invalid entries; existing keyword behavior is preserved.
- **Caught and restored during content verification:** Fly's preboot deployment advice must retain its exact runtime-mode instructions; host-signal behavior stays unchanged.
- **Open, pre-existing:** `manifest.default-tools-read.test.ts` and `bundled-higgsfield-video-docs.unit.test.ts` expect only two reviewed tools/no grant defaults, but the base Higgsfield manifest already declares eight allow, three write and five read tools. Grants and assertions were not weakened. These account for one failure in each of two focused batches.
- **Open, pre-existing test setup:** two bundled-deploy tests cannot resolve optional peer `@jini-ai/cms` from copied Cloudflare payloads under /tmp. No vendor/runtime code or dependency requirements were changed to hide this.
- **Open, pre-existing admin tsc:** two calls in `apps/admin/src/lib/__tests__/agent-plugin-choice-replay.unit.test.ts` omit workspaceId, conversationId, preferenceRevisionSeq and selected required by askAgentPluginChoice. Both the fixture and the called implementation are unchanged from the base.
- **Open, pre-existing lint:** comment-only AgentPluginRow.tsx has complexity10 versus configured9 (confirmed identical at base); existing bundled-deploy test callback has complexity14 and plugin-embed-bundled test functions have11/12. Four existing api.ts lint warnings also remain. No rule/test was disabled or weakened.
- **Setup repaired:** supplied dependency links/build outputs were stale. Frozen-lockfile install using a writable workspace store, Jini rebuild, Tovu contracts rebuild and relink resolved setup issues without dependency manifest/lockfile changes. A pre-existing untracked legacy plugin-ui-ux-design directory remains excluded and untouched.

## Size and cost

Line counts compare implementation tips to their specified bases; report/changelog/README documentation is excluded. Production payloads include manifests, generated catalog, runtime skills/overlays and policy data; source code is shown separately from tests.

| Repository | Production source + / − | Production payload + / − | All production + / − | Tests + / − |
| --- | --- | --- | --- | --- |
| Jini | +436 / −29 | +466 / −513 | +902 / −542 | +311 / −118 |
| Tovu | +81 / −334 | +1216 / −4 | +1297 / −338 | +371 / −151 |

No tables, persisted state, polling, extra manifest reads or network calls were added. Parsing reuses existing reads; cost is linear in the loaded metadata/payload. Credential declarations remain capped at 32 cards × 16 fields. Compatibility warnings occur on those existing loads. Generic validation lives in Jini; Tovu keeps host wiring. No plugin imports another plugin and no vendor code was added to core. Architecture audit: PASS for the changed boundary. Runtime self-validation uses fake/local fixtures and actual tool delivery, with no live/owner data.

## Verification commands and results

All commands source `/workspace/.tovu-build/env.sh` first. Run Jini commands from `/workspace/Jini`, Tovu commands from `/workspace/Tovu` unless stated. No full test suites were run.

Jini setup: `pnpm --filter @jini-ai/core run build`; `pnpm --no-bail -r build` (first run found stale dependency links; after `CI=true pnpm install --frozen-lockfile --store-dir /workspace/work/pnpm-store --cache-dir /workspace/work/pnpm-cache`, rebuild passed). The writable store was copied from the supplied runtime store, without changing any dependency manifests/lockfiles. Tovu: `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini`; `npm --prefix packages/contracts run build`.

Jini focused parser checks:
```sh
pnpm --filter @jini-ai/agent-plugins test src/lifecycle/__tests__/unit/manifest.unit.test.ts src/lifecycle/__tests__/unit/manifest-1-1-0.unit.test.ts src/lifecycle/__tests__/unit/manifest-boundaries.unit.test.ts src/lifecycle/__tests__/unit/manifest-extensions.unit.test.ts src/lifecycle/__tests__/unit/manifest-default-namespace.unit.test.ts src/lifecycle/__tests__/unit/portable-metadata.unit.test.ts src/lifecycle/__tests__/unit/installed-package-index.unit.test.ts src/lifecycle/__tests__/unit/capability-projection.unit.test.ts src/lifecycle/__tests__/unit/core-persistent-state.unit.test.ts
pnpm --filter @jini-ai/agent-plugins test src/lifecycle/__tests__/unit/portable-metadata.unit.test.ts src/lifecycle/__tests__/unit/installed-package-index.unit.test.ts src/lifecycle/__tests__/unit/manifest-extensions.unit.test.ts src/folder-customization.test.ts
pnpm --filter @jini-ai/agent-plugins exec vitest run src/lifecycle/__tests__/unit/credential-card-metadata.unit.test.ts
pnpm exec vitest run scripts/__tests__/plugin-release-consistency.test.ts
pnpm --filter @jini-ai/agent-plugins run typecheck
pnpm --filter @jini-ai/agent-plugins build
pnpm --filter @jini-ai/plugin-catalog exec tsc --noEmit --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck scripts/generate.ts
pnpm guard:plugins
pnpm exec eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' packages/agent-plugins/src/core/identity-namespace.ts packages/agent-plugins/src/folder-zip-node.ts packages/agent-plugins/src/lifecycle/{manifest,metadata,installed-package-index,capability-projection,install,persistent-state}.ts
```
Initial groups passed187 then52; credential cards5/5; release consistency9/9; package build/typecheck, generator tsc, plugin guards and strict production lint passed.

Tovu focused host tests:
```sh
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/features/agent-plugins/__tests__/unit/{portable-readers,manifest,host-signals,plugin-credential-cards,identity,supersession,tw2-L224-characterization,apply-connect-defaults,apply-tool-renames,connect-tool,connect-skip,declined-access,grant-signed-in-defaults,federate-mcp,access-token-tool,import-access-token,new-site-agent-plugin-tokens,token-sign-in}.unit.test.ts apps/website/src/features/agent-plugins/__tests__/unit/enable-access.regression.test.ts apps/website/src/features/agent-plugins/__tests__/manifest.default-tools-read.test.ts
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/features/agent-plugins/__tests__/unit/portable-readers.unit.test.ts apps/website/src/assistant/__tests__/declared-tool-keywords.contract.test.ts apps/website/src/assistant/__tests__/declared-tool-keywords-lazy.contract.test.ts
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/features/agent-plugins/__tests__/unit/capability-projection.unit.test.ts apps/website/src/features/agent-plugins/__tests__/unit/portable-host-guidance.unit.test.ts
TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --test apps/website/src/features/member-login/__tests__/providers.test.ts apps/website/src/server/runtime/composition/__tests__/domain-dns-adapters.test.ts
npx tsc -p tsconfig.json --noEmit
npx eslint apps/website/src/assistant/tool-search-keywords.ts apps/website/src/features/agent-plugins/{mcp-metadata,access-token-tool,apply-connect-defaults,apply-tool-renames,connect-card-ui,connect-tool,credential-cards,customize-tool,federate-mcp,grant-signed-in-defaults,host-signals,identity,import-access-token,lifecycle,new-site-agent-plugin-tokens,provider-plugin-link,supersession,token-sign-in}.ts apps/website/src/features/agent-plugins/exports/source.ts
npx eslint apps/website/src/features/agent-plugins/capability-projection.ts apps/website/src/features/agent-plugins/__tests__/unit/portable-host-guidance.unit.test.ts
npx eslint --no-error-on-unmatched-pattern apps/website/src/features/member-login/providers.ts apps/website/src/server/runtime/composition/domain-dns-adapters.ts
```
328-reader group:327 passed, one pre-existing stale grant expectation. Keywords/portable7/7; capability/guidance14/14 before final expanded variant; member-login/DNS77/77. Website tsc and changed production logic lint passed. Desktop, from `/workspace/Tovu/apps/desktop`: `node --import ./scripts/resolve-ts-ext.ts --test src/stage-payload-lib.test.ts` passed84/84.

Final namespace compatibility checks (Jini):
```sh
pnpm --filter @jini-ai/agent-plugins test src/lifecycle/__tests__/unit/layout-b-persistent-state.unit.test.ts src/lifecycle/__tests__/unit/lifecycle-reconciliation.unit.test.ts src/lifecycle/__tests__/unit/manifest-default-namespace.unit.test.ts src/lifecycle/__tests__/unit/manifest-extensions.unit.test.ts src/lifecycle/__tests__/unit/installed-package-index.unit.test.ts
```
52/52 passed, including the original custom-host migration regression and a new custom-versus-legacy precedence regression, each observed failing before the fix.

Final payload/catalog checks:
```sh
# Jini
pnpm --filter @jini-ai/agent-plugins test src/lifecycle/__tests__/unit/plugins-host-neutrality.test.ts
mapfile -t tests < <(git diff --name-only origin/cloud/combine -- 'packages/agent-plugins/*/__tests__/*.mjs' 'packages/agent-plugins/*/**/__tests__/*.mjs'); node --test "${tests[@]}"
pnpm --filter @jini-ai/plugin-catalog generate
pnpm --filter @jini-ai/plugin-catalog test
# Tovu
mapfile -t tests < <(git diff --name-only origin/cloud/combine -- 'content/agent-plugins/*/__tests__/*.mjs' 'content/agent-plugin-overlays/*/__tests__/*.mjs'); node --import tsx --test "${tests[@]}"
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/features/agent-plugins/__tests__/unit/portable-host-guidance.unit.test.ts
npm --prefix apps/admin run typecheck
npm --prefix apps/desktop run typecheck
```
Results: neutrality34/34; Jini content122/122; catalog65/65 after final regeneration; Tovu overlays254/254; actual23-plugin guidance delivery1/1; desktop typecheck passed; admin typecheck found two existing fixture call errors described under Bugs found.

Affected bundled source checks (Tovu):
```sh
TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-concurrency=1 apps/website/src/features/agent-plugins/__tests__/unit/bundled-software-engineering-package.unit.test.ts apps/website/src/features/agent-plugins/__tests__/unit/plugin-embed-bundled.test.ts apps/website/src/features/agent-plugins/__tests__/unit/bundled-tovu-theme-package.unit.test.ts apps/website/src/features/agent-plugins/__tests__/unit/bundled-search-meilisearch.unit.test.ts apps/website/src/features/agent-plugins/__tests__/unit/bundled-higgsfield-video-docs.unit.test.ts apps/website/src/features/agent-plugins/__tests__/unit/bundled-github-actions-ops.unit.test.ts apps/website/src/features/agent-plugins/__tests__/unit/bundled-deploy-package.unit.test.ts
TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-name-pattern='manifest canonical IDs|portable vendor aliases' apps/website/src/features/deployments/deploy-targets/__tests__/no-vendor-in-core.boundary.test.ts
```
Results40/43 (one stale grant assertion, two optional-peer resolution failures); vendor boundary2/2. These existing failing assertions were not weakened.

Source-neutrality check (Jini) passed with zero violations:
```sh
node --import tsx --input-type=module - <<'JS'
import {checkSourceNeutrality} from './scripts/lib/source-neutrality.ts';
const findings=checkSourceNeutrality({repoRoot:process.cwd()});
console.log(JSON.stringify(findings));
process.exitCode=findings.length?1:0;
JS
```
Both repositories pass `git diff --check`.

Final legacy-null compatibility regression (Jini): `pnpm --filter @jini-ai/agent-plugins test src/lifecycle/__tests__/unit/portable-metadata.unit.test.ts src/lifecycle/__tests__/unit/manifest-extensions.unit.test.ts src/lifecycle/__tests__/unit/manifest-boundaries.unit.test.ts` —52 passed; then the strengthened6-test portable metadata file passed again. Package build and strict core helper lint passed. Legacy null aliases preserve fallback; canonical malformed values still exclude the server.
