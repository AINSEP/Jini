# one-card — completed with open items

The bounded implementation and focused verification are complete. Universal one-card coverage and published-package adoption remain incomplete for the cases listed below. No deployment, publishing, tags, force pushes, or main pushes occurred. The two-hour cap was honored.

## Branches and code heads

Both repositories use `cloud/one-card`, created from the current `origin/cloud/small-fixes` tips. The code heads below were confirmed pushed before this report; the final report-only commit follows them.

- Jini: code head `b7f53c43a53d18876760f6e50e09c3e1bec19e9b`; base `7d91815d22b199a8263006b5d97b3acba3fd743e`.
- Tovu: code head `2890d82b73e3b258909c255618706a1ce779194d`; base `d23b6f700b01436c8287b54bb596111c83d914aa`.

Authority: `origin/cloud-plans-1105:cloud/jobs/COMMON.md`, `cloud/jobs/one-card.md`, `cloud/plans/OC-one-card-plan.md`, and `cloud/plans/TRIM.md`. Loaded the software-architect, programmer, and TDD personas from `/workspace/cloud/ai-dev-shop`.

## What changed

1. Jini's existing approval lifecycle accepts typed access plans. Access plans always ask freshly, ignore remembered grants, detach their disclosure, and enforce 128 resources / 128 KiB. The shared presentation reuses the existing trusted-click, dwell, and non-clickable discovery behavior.
2. Browser replies require a session credential and an actual active human. Existing principal/tool exchange binding remains. The host rechecks the active person before access disclosure and after confirmation; domain writers retain their own current authorization.
3. Both plugin-enable families use the common access card. Signed-in OAuth and saved-token repair cannot silently widen grants. Approved source/grant snapshots and fresh installed declarations are checked before effects. Declining retained-access repair performs no provisioning/adoption. Approved grant writers reject missing snapshots before activation.
4. External MCP access-only changes use fixed proposals. SQL/memory conditional updates preserve credential and metadata columns, reject stale sources/grants, and retain the 64-name/subset limits. Credential forms show fixed tool/write disclosures instead of editable permission fields.
5. Protected settings always use a fresh card, including privacy and custom instructions. The displayed revision reaches the existing transactional set/clear writer. Plugin identity, chat selection, aliases, dedicated writers, personal scope, and ordinary-setting behavior remain. Secret-marked definitions are refused before reading values or opening cards.
6. Visitor-tool, comments-provider, and CLI prelaunch access cards use typed resources and existing effect owners. CLI consent RPCs now require an active human too.
7. Jini exposes an identity-bound read of existing frozen tool names. New external grants and disabled-source activation require verified actual names. Approval adds no remote tools/list, poll, table, worker, or registry framework.

## Open work and deliberate exclusions

- Consent update/publication tools remain unchanged for `cloud/consent-declare`.
- Permanent-delete grants and mail test mode remain excluded. Credential entry and OAuth keep their existing owners.
- Automatic plugin multi-select / Use-for-chat / personal-Auto card remains. Replacing it would expand the selection, receipt, and unversioned personal-preference lifecycle; the job permits leaving a large card migration.
- Mail-provider card remains. Atomic snapshot support would expand six provider/control/composition/writer seams; it was left under the same job exception.
- A source without a matching frozen catalog cannot receive new arbitrary tool grants. This includes uncached disabled or local/stdio sources. Empty-grant activation followed by ordinary discovery and a later access request can require two cards. Universal one-card support is therefore not claimed. No new probe fallback was added because the existing probe can refresh/persist credentials and rejects disabled/stdio sources.
- Published adoption remains open. `npm view` returned `0.6.23` for both core and UI. These new APIs are unreleased; manifests were not changed to nonexistent versions and nothing was published. Tovu requires the paired Jini code/build until a compatible release is adopted.
- Tests cover actual adapter staging/credential resolution and shared dispatch for all registered agents, plus the real BYOK tool surface. Live CLI binaries and external provider accounts were not launched.

## Verification commands and results

Commands below ran in the container. Source `/workspace/.tovu-build/env.sh` first. Node test files were also executed directly to verify named assertions: file-only/empty runner output was not counted as proof.

### Setup and type checks

- Jini: `CI=true pnpm install --frozen-lockfile --store-dir /workspace/.tovu-build/pnpm-store --cache-dir /workspace/.tovu-build/pnpm-cache` — passed. The inherited home cache is read-only; the first install attempt failed there.
- Jini: `pnpm -r build` — passed after dependency setup. The initial pre-change attempt stopped at missing user-management/MFA dependencies.
- Tovu: `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini` — passed after rebuilding.
- Tovu: `npm --prefix packages/contracts run build` — passed.
- Jini: `npm --prefix packages/core run typecheck`, `npm --prefix packages/ui run typecheck`, `pnpm --filter @jini-ai/daemon exec tsc -p tsconfig.json --noEmit`, and `pnpm --filter @jini-ai/mcp run build` — passed.
- Tovu: `npx tsc -p tsconfig.json --noEmit` — final combined source check passed.
- Both repositories: `git diff --check` — passed.

### Jini focused tests

From `/workspace/Jini`:

| Exact command | Result |
| --- | --- |
| `npm --prefix packages/core run test -- src/__tests__/access-approval.test.ts src/__tests__/approval.test.ts src/__tests__/approval.characterization.test.ts` | 72 passed |
| `npm --prefix packages/core run test -- src/settings/__tests__/tool-registrations.set-value.test.ts src/settings/__tests__/tool-registrations.clear-value.test.ts src/settings/__tests__/agent-value-write-tools.pins.test.ts` | 63 passed |
| `npm --prefix packages/ui run test -- src/features/mcp-ui/__tests__/surfaces/access-approval.test.ts src/features/mcp-ui/__tests__/surfaces/confirmation.test.ts` | 66 passed |
| `pnpm --filter @jini-ai/mcp exec vitest run src/federation/__tests__/reload-frozen-grants.test.ts` | 1 passed |
| `pnpm --filter @jini-ai/daemon exec vitest run src/agent-executor/__tests__/access-approval-transport.test.ts src/agent-executor/__tests__/full-cli-mcp-policy.test.ts src/__tests__/delegated-tool-bridge.mcp-ui.test.ts src/__tests__/surface-exchanges.run-lifetime.test.ts --reporter=verbose` | 92 passed; 65 new matrix cases cover 28 definitions and all six bridge strategies |

### Tovu focused tests

From `/workspace/Tovu`, the command prefixes actually used are below; append the FILE in the table. Source `/workspace/.tovu-build/env.sh` first. Output redirection is omitted.

```sh
# A
node --import tsx FILE
# B
node --import tsx --import ./development/test-support/composed-bundle-env.ts --experimental-test-module-mocks FILE
# C
node --import tsx --import ./development/test-support/composed-bundle-env.ts FILE
# D
TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --experimental-test-module-mocks FILE
# E
TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --import ./development/test-support/composed-bundle-env.ts --experimental-test-module-mocks FILE
```

FILE paths are relative to the repository root. Browser/RPC tests used network-enabled sandbox access for localhost listeners.

| Prefix | FILE | Result |
| --- | --- | --- |
| A | `apps/website/src/assistant/__tests__/access-approval.integration.test.ts` | 6 passed |
| A | `apps/website/src/contracts/core/__tests__/human-confirm.lifecycle.test.ts` | 18 passed |
| B | `apps/website/src/server/__tests__/admin-mcp-ui-tool-calls-route.test.ts` | 18 passed |
| B | `apps/website/src/assistant/__tests__/byok-tool-surface.test.ts` | 85 passed, including five real BYOK access outcomes |
| C | `apps/website/src/features/settings/__tests__/settings-write-tools.test.ts` | 94 passed |
| A | `apps/website/src/features/external-mcp/__tests__/access-grants.contract.test.ts` | 30 passed across memory, SQLite and PGlite |
| A | `apps/website/src/features/external-mcp/__tests__/access-save.integration.test.ts` | 10 passed |
| A | `apps/website/src/features/external-mcp/__tests__/unit/save-form.unit.test.ts` | 38 passed |
| B | `apps/website/src/assistant/__tests__/tool-registrations.external-mcp.test.ts` | 39 passed |
| D | `apps/website/src/features/agent-plugins/__tests__/unit/connect-tool.unit.test.ts` | 54 passed |
| D | `apps/website/src/features/agent-plugins/__tests__/unit/enable-access.regression.test.ts` | 19 passed |
| D | `apps/website/src/features/agent-plugins/__tests__/unit/apply-connect-defaults.unit.test.ts` | 15 passed |
| D | `apps/website/src/assistant/__tests__/tool-registrations.plugins-set-enabled-families.test.ts` | 28 passed |
| D | `apps/website/src/features/plugin-runtime/__tests__/unit/plugins-tool-registrations.unit.test.ts` | 23 passed |
| D | `apps/website/src/features/plugin-runtime/__tests__/unit/plugins-set-enabled-consent.unit.test.ts` | 31 passed |
| D | `apps/website/src/features/plugin-runtime/__tests__/unit/set-enabled-confirmation-ui.unit.test.ts` | 3 passed |
| D | `apps/website/src/features/plugin-runtime/__tests__/unit/plugin-enable-access.regression.test.ts` | 2 passed |
| D | `apps/website/src/features/plugin-runtime/__tests__/unit/sealed-plugin-consent.regression.test.ts` | 1 passed |
| D | `apps/website/src/features/plugin-runtime/__tests__/unit/plugin-enable-reload-result.unit.test.ts` | 1 passed |
| E | `apps/website/src/features/settings/__tests__/visitor-tools-registrations.unit.test.ts` | 10 passed |
| E | `apps/website/src/features/comments/__tests__/provider-tools.test.ts` | 5 passed |
| E | `apps/website/src/server/inbound/assistant/__tests__/assistant-tool-consent.unit.test.ts` | 8 passed |
| E | `apps/website/src/server/runtime/composition/modules/__tests__/agent-daemon-consent-rpc.integration.test.ts` | 10 passed |
No full repository test suite was run. Tests/rules were not disabled, skipped, deleted, or weakened. Earlier expectations of silent grants/editable permission fields were replaced with stronger fixed-card, before-click, and persisted-result assertions.

### Packed compiled consumption

From Jini, built core/UI/agentic and ran:

```sh
pnpm --dir packages/core pack --pack-destination /workspace/work/one-card/pack
pnpm --dir packages/ui pack --pack-destination /workspace/work/one-card/pack
pnpm --dir packages/agentic pack --pack-destination /workspace/work/one-card/pack
node /workspace/work/one-card/pack/consumer/verify.mjs
```

The actual tarballs were unpacked into isolated node_modules, with no symlinks or source substitutions. Public imports resolve to compiled dist. Result: two fresh decisions, one accepted write, zero remembered-grant calls; decline has zero effects; fixed HTML is escaped and callback credentials are absent from discovery metadata.

### Complexity lint

Ran ESLint on every existing changed production JS/TS file, excluding tests, both normally and with:

```sh
--no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}'
```

Tovu repository-default lint passed on all 32 changed production files. Jini strict lint passed (one pre-existing nesting warning). All added/changed logic meets the ceiling. Tovu whole-file strict checks retain two verified unchanged base violations: `createByokToolSurface` (12) and `resolveExternalMcpAccessToken` (11). No exemptions were added.

## Bugs found (one per line)

FIXED: API-key and nonhuman-session browser callbacks could redeem approvals; real route regressions failed before the guard and now pass.

FIXED: Signed-in connect could grant declared defaults without a fresh card; retained OAuth declines could also provision/adopt first.

FIXED: Plugin declarations and source snapshots could drift while the card was open, or be validated after activation; they are checked before effects and again at conditional persistence.

FIXED: Whole-row access writes could overwrite concurrent credential refreshes; access writes now touch access columns only.

FIXED: A setting could change after its post-card read but before its transactional write; revision CAS closes that window and rolls back the losing revision.

FIXED: Secret settings could reach generic writes/cards; canonical secret definitions and aliases now refuse before reading values.

FIXED: Arbitrary absent tool names could be persisted as future preauthorization; new grants now require the exact source's known catalog.

OPEN MINOR: Definition listings can still advertise secret definitions as agent-writable even though execution now refuses them.

BASELINE TEST FAILURE: `apps/website/src/assistant/__tests__/mcp-ui-allowlist-completeness.test.ts` — 8/9 pass; parser treats `site-sealer.ts:54` and `owner-mfa-deps.ts:28` sealer `.open(input)` as unresolved exchange openers. Reproduced with direct Node invocation on an archived `origin/cloud/small-fixes` source tree; the failing assertion and paths are identical.

BASELINE TEST FAILURE: `apps/website/src/assistant/__tests__/approval-single-path.test.ts` — 0/1 pass; pre-existing `requireHumanConfirm` in `server/runtime/composition/tool-catalog-manifest.ts` is missing from the test's reviewed-host list. Reproduced with direct Node invocation on the archived base; the same reviewed-host assertion fails.

BASELINE TEST FAILURE: `apps/website/src/server/runtime/composition/__tests__/plugin-host.integration.test.ts` — 23/24 pass; publisher expectation is `tovu/commerce`, base manifest/identity returns `jini/commerce`. The unchanged base identity implementation and manifest reproduce the mismatch. New snapshot tests pass. No assertion was relaxed.

BASELINE LINT: The two strict complexity violations above remain listed rather than changed.

## State and resource cost

- Human validation: two indexed principal projections per common access card; browser session resolution remains the existing middleware.
- CLI: one indexed principal read per existing consent RPC; pre-display/post-click checks add two existing snapshot RPC requests for that card, without a new RPC method.
- Access persistence: one preview point read plus the existing conditional writer's locked read and access-only update per changed source. No credential/vault write is added by this access writer.
- Settings: one addressed-layer read inside each approved transactional write.
- Frozen catalog: local detached name enumeration only, proportional to existing frozen tool definitions. Zero new tools/list calls, polls, workers or durable state.
- Plugin application reuses existing manifest/source reads and notifications; snapshot parsing is local and scales with the approved source list/proposal bytes. Multi-store accepted operations can still partially succeed if a later existing writer fails; failures are surfaced, not silently retried.
- No physical byte/query instrumentation or live external-account behavior is claimed.

## Exact changed files

### Jini

```text
A	cloud/reports/one-card.md
A	packages/core/src/__tests__/access-approval.test.ts
M	packages/core/src/approval.ts
M	packages/core/src/settings/__tests__/tool-registrations.clear-value.test.ts
M	packages/core/src/settings/__tests__/tool-registrations.set-value.test.ts
M	packages/core/src/settings/agent-value-write-tools.ts
A	packages/daemon/src/agent-executor/__tests__/access-approval-transport.test.ts
M	packages/mcp/src/federation/__tests__/reload-frozen-grants.test.ts
M	packages/mcp/src/federation/frozen-grants.ts
M	packages/mcp/src/federation/index.ts
A	packages/ui/src/features/mcp-ui/__tests__/surfaces/access-approval.test.ts
A	packages/ui/src/features/mcp-ui/surfaces/access-approval.ts
M	packages/ui/src/features/mcp-ui/surfaces/index.ts
```

### Tovu

```text
M	apps/website/src/__tests__/support/plugin-tool-host.ts
M	apps/website/src/__tests__/support/render-human-approval.ts
A	apps/website/src/assistant/__tests__/access-approval.integration.test.ts
M	apps/website/src/assistant/__tests__/byok-tool-surface.test.ts
M	apps/website/src/assistant/__tests__/tool-registrations.external-mcp.test.ts
M	apps/website/src/assistant/__tests__/tool-registrations.plugins-set-enabled-families.test.ts
M	apps/website/src/assistant/byok-tool-surface.ts
M	apps/website/src/assistant/external-mcp-connection-source.ts
M	apps/website/src/assistant/tool-registrations.ts
M	apps/website/src/contracts/core/chat-delete-grant.ts
M	apps/website/src/contracts/core/human-confirm.ts
M	apps/website/src/contracts/headless/plugin-host.ts
M	apps/website/src/features/agent-plugins/__tests__/unit/connect-tool.unit.test.ts
M	apps/website/src/features/agent-plugins/__tests__/unit/enable-access.regression.test.ts
M	apps/website/src/features/agent-plugins/apply-connect-defaults.ts
M	apps/website/src/features/agent-plugins/connect-tool.ts
M	apps/website/src/features/agent-plugins/enable-access.ts
M	apps/website/src/features/agent-plugins/grant-signed-in-defaults.ts
M	apps/website/src/features/agent-plugins/service-ports.ts
M	apps/website/src/features/agent-plugins/tool-registrations.ts
M	apps/website/src/features/comments/__tests__/provider-tools.test.ts
M	apps/website/src/features/comments/tool-registrations.ts
A	apps/website/src/features/external-mcp/__tests__/access-grants.contract.test.ts
A	apps/website/src/features/external-mcp/__tests__/access-save.integration.test.ts
M	apps/website/src/features/external-mcp/__tests__/unit/save-form.unit.test.ts
M	apps/website/src/features/external-mcp/agent-tools.ts
M	apps/website/src/features/external-mcp/contracts.ts
M	apps/website/src/features/external-mcp/deps.ts
M	apps/website/src/features/external-mcp/external-mcp-repo.ts
M	apps/website/src/features/external-mcp/external-mcp-store.memory.ts
M	apps/website/src/features/external-mcp/external-mcp-store.ts
M	apps/website/src/features/external-mcp/save-form.ts
M	apps/website/src/features/external-mcp/tool-registrations.ts
M	apps/website/src/features/plugin-runtime/__tests__/fixtures/plugins-tool-harness.ts
M	apps/website/src/features/plugin-runtime/__tests__/unit/plugin-enable-access.regression.test.ts
M	apps/website/src/features/plugin-runtime/__tests__/unit/plugins-set-enabled-consent.unit.test.ts
M	apps/website/src/features/plugin-runtime/__tests__/unit/set-enabled-confirmation-ui.unit.test.ts
M	apps/website/src/features/plugin-runtime/agent-tools.ts
D	apps/website/src/features/plugin-runtime/set-enabled-confirmation-ui.ts
M	apps/website/src/features/plugin-runtime/tool-registrations.ts
M	apps/website/src/features/settings/__tests__/settings-write-tools.test.ts
M	apps/website/src/features/settings/__tests__/visitor-tools-registrations.unit.test.ts
M	apps/website/src/features/settings/tool-registrations.ts
M	apps/website/src/features/settings/visitor-tools-registrations.ts
M	apps/website/src/server/__tests__/admin-mcp-ui-tool-calls-route.test.ts
M	apps/website/src/server/inbound/assistant/__tests__/assistant-tool-consent.unit.test.ts
M	apps/website/src/server/inbound/assistant/agent-daemon-scope.ts
M	apps/website/src/server/inbound/assistant/assistant-tool-consent.ts
M	apps/website/src/server/runtime/composition/__tests__/plugin-host.integration.test.ts
M	apps/website/src/server/runtime/composition/modules/__tests__/agent-daemon-consent-rpc.integration.test.ts
M	apps/website/src/server/runtime/composition/modules/agent-daemon-core-rpc.ts
M	apps/website/src/server/runtime/composition/modules/assistant-byok.ts
M	apps/website/src/server/runtime/composition/modules/assistant.ts
M	apps/website/src/server/runtime/composition/plugin-host.ts
M	apps/website/src/server/runtime/composition/tool-catalog-manifest.ts
A	cloud/reports/one-card.md
```

## Commit ledger

All code commits below were confirmed pushed only to `cloud/one-card`. The report-only commit follows this ledger.

### Jini

```text
d379d8819179a3e66ec29e44c8112b95d840fd1b docs: record access approval work in progress
a851775665af10861336dc050516b62a6e857358 Add fresh access approval plans and shared disclosure
15018e0d7e3865b5b91f070a4d2b78738f50bcfc Test approved setting revisions at the write boundary
d20fd4b277775dcf4be7b1e9409b9eb149b6efb4 Guard approved settings writes against concurrent revisions
26d7fb3c949dd57fd18edf2bafcf13182eb0f60e Keep approved setting revision mapping within complexity limits
bab3e359f2d5dc80f11e5ac14b344db2c41540b9 Keep secret settings outside assistant value writes
8bfa46e0b89d9ebdc5ddf02e06b1a93587ff51f9 Verify access approval across registered MCP runtime adapters
b7f53c43a53d18876760f6e50e09c3e1bec19e9b fix: expose identity-bound cached federation tool names
```

### Tovu

```text
2f89dee94c0769fc0522486c9ac5f696a483d6c3 docs: record access approval work in progress
efbf0638dd11b96c9f12463730c1df5cae71ea4c Use fresh access plans in the human confirmation lifecycle
dd86d9250088d68a8d7694e25f690d5b39cb74fb fix: preserve connection credentials during approved access changes
779104fb7fa35c8db411a442be0f132e29eef93c fix: forward conditional access writes through roster adapter
143da4935a381a2214bdfb04c7dace96be06935a Require active people for access approval transport
f071839ead54f82bb651db36f41b79f7d4ddc519 fix: require fresh approval for plugin access changes
1b3d4d9002c52a8a9893c5f9ddc8f7907f923bb5 Test fresh setting access decisions
b7ec53409a95bf154c7ac5371ed18914fee4b423 Bind access disclosures to the approving person
717964c1bc268eb75d8c185d46c00949097567f8 wip: route connection access proposals through shared approval
1135f5f088cd99ffc0ccf517e6b160c47e2da9c6 Reject nonhuman approval callbacks before exchange delivery
a0f5907b175234619f40645992567cfa7b6ccfbb Require fresh common access cards for protected settings
6722733d315bad8c6033e900c5bf3573a3f4ac1d Keep callback validation within complexity limits
40d92e20b2b3024de5dc8407e33ede4cac677684 fix: disclose fixed connection access and verify approval outcomes
f3329735680a311f155b1c15f54ac4d11628c1da Unify visitor comments and CLI access cards
935bae1beb2d782246853223d3e8f4192288dc1f Verify bound access approval through the BYOK tool surface
204ecb6cd54b30b1dcafb925b473f7884ae03e56 fix: bind retained plugin access to approved source snapshots
3626a41b4cad7b792d603354f807a36804a239ec fix: require verified source tools before widening access
4ec06f352bfdc53326650c823f6baddc29c112f4 fix: reject approved plugin grants missing their source snapshot
2890d82b73e3b258909c255618706a1ce779194d fix: validate approved source state before plugin activation
```

## Workspace notes

Tracked code changes are committed. A pre-existing untracked `Jini/packages/plugin-ui-ux-design/` leftover remains untouched and is not part of this branch. Build/link outputs and raw logs are local setup artifacts, not committed deliverables. No owner/live data was used.
