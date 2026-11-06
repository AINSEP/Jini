# tag-b — complete

Branch: `cloud/tag-b`. Base: `origin/cloud/combine` at `3a86f98ba03380651c8bf64b8fc18c4f90a122fd`. Source/checkpoint HEAD before final report commit: `d4777af8355082c9b94b7f9007f9ab1733fe057f`. Completed within the two-hour cap.

## Result

TAG-B plan steps 2, 3, 4 and remaining step 6 are implemented with the TAG trim. Automatic handles use stable mounted React identity; explicit names are preserved and explicit opt-out wins over defaults. Remount/reload may change an automatic handle. Independent SSR roots use React identifierPrefix.

- Jini ui-kit and shared UI control owners default to tags on actual controls. Menus/tabs/options/attachments/folders derive leaf identity from stable IDs; filtered values with colliding slugs no longer change addresses.
- Named wrappers, shadcn fields and EntityField forward handles, page identity and opt-out. Existing explicit portal containers and native-dialog ownership take precedence over the existing kit overlay context. Portals stay within the supplied host root.
- Composer and AgentRuntimePicker accept a base/false and forward it to package-owned controls, including runtime/model/reasoning rows, draft/send/stop, discovery, attachments and folders.
- Secret input/textarea/reveal controls remain private after reveal and portal mounting. Withheld approval actions cannot regenerate handles through nested facades. Ordinary feature confirmations default on; existing explicit cancellation policy is preserved.
- Duplicate active handles warn and refuse ambiguous actions before effects; discovery still exposes the collision. Hidden/inactive panels and background controls behind an active modal remain ineligible.
- Tovu injects the existing agent-attribute port and roots page overlays inside its existing main content driver root. Chat send and approval controls stay outside that root. Git Backup fields/retry/repeat/cancel and Menu Editor copy have direct handles.

Tags grant no driving permission. Existing approval policy, visitor publication checks, query filters and 64 KiB output cap remain. No new registry, observer, table, schema, framework, polling, dependency, deployment or package release. Tovu's dependency manifests remain unchanged; validation uses the authorized local Jini links.

## Setup

COMMON.md, tag-b.md, TAG-plan-result.md and TRIM.md were read via git show origin/cloud-plans-1105. Software Architect, Programmer and TDD personas were loaded from the requested plans-branch AI-Dev-Shop. Work was split among repository-requested helper agents with explicit file ownership.

The requested fetch succeeded with supported network permission. This clone needed an explicit refspec to create origin/cloud-plans-1105 because its fetch configuration initially tracked only main. Both branches were created from the current origin/cloud/combine tips shown above. Every push used pull --rebase first and targeted cloud/tag-b only; no force push.

Initial setup had stale links/dist: provider-plugins could not resolve its declared jsdom/cms dependencies, and Tovu could not resolve new contracts exports. A frozen install with a copied workspace-local pnpm store (the home cache was read-only), contracts rebuild and Jini rebuild/relink resolved setup failures without source workarounds. Untouched targeted baseline: driver 117 tests and Tovu 48 tests passed. PostgreSQL was not needed. No live or owner data was used.

All following commands source /workspace/.tovu-build/env.sh first. Paths are relative to the named repository. Setup/final build commands:

```sh
# Jini
pnpm install --frozen-lockfile --store-dir /workspace/.tovu-build/pnpm-store
pnpm -r build
# Tovu
npm --prefix packages/contracts run build
JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini
```

Final recursive build and relink: PASS. Final raw logs: /workspace/work/tag-b/jini-final-build.log and jini-final-relink.log.
## Jini validation

Driver: 118 tests passed, plus 85 focused private/elements/visitor-publication tests. New warning regression was observed failing before its fix.

```sh
npm --prefix packages/agentic test -- src/core/dom/__tests__/dom-page-driver.test.ts
npm --prefix packages/agentic test -- src/core/dom/__tests__/visitor-publication.test.ts src/core/dom/__tests__/dom-page-driver-private.test.ts src/core/dom/__tests__/dom-page-driver-elements.test.ts
npm --prefix packages/agentic run typecheck
```

ui-kit: 201 React tests across 14 files passed before the final composite privacy ordering fix; the final five-file affected rerun passed 57 tests after that fix. Typecheck, strict complexity 10 and build passed.

```sh
pnpm --filter @jini-ai/ui-kit exec vitest run src/react
pnpm --filter @jini-ai/ui-kit exec vitest run src/react/__tests__/default-agent-tags.test.ts src/react/__tests__/secret-field.test.ts src/react/__tests__/confirm.test.ts src/react/__tests__/conformance.test.ts src/react/native/__tests__/navigation.characterization.test.ts
pnpm --filter @jini-ai/ui-kit run typecheck
pnpm --filter @jini-ai/ui-kit run build
```

UI final affected run: 345 tests / 22 files passed. Admin EntityField: 23 tests passed. Actual DOM-driver integration covers menu/options, tab activation/close, dialog close, native-dialog priority, inactive views, scoped portals/page identity, duplicate refusal and private portal descendants.

```sh
pnpm --dir packages/ui exec vitest run src/features/admin-widgets/__tests__/Select.hooks.unit.test.tsx src/react/__tests__/components/CustomSelect.test.tsx src/features/admin-widgets/__tests__/Select.unit.test.tsx src/features/admin-widgets/__tests__/InfoTip.unit.test.tsx src/react/__tests__/unit/select-popover.unit.test.ts src/features/admin-widgets/__tests__/SeeMore.unit.test.tsx src/features/tab-strip/__tests__/react/components/TabStripItem.test.tsx src/features/tab-strip/__tests__/react/components/TabStrip.test.tsx src/features/tab-strip/__tests__/react/components/TabStrip.dual-shape.test.tsx src/react/__tests__/components/agent-handles-driver.integration.test.tsx src/features/execution/__tests__/react/components/SearchableModelSelect.test.tsx src/features/admin-widgets/__tests__/ImagePreviewModal.unit.test.tsx src/features/admin-widgets/__tests__/SuggestInput.unit.test.tsx src/features/admin-widgets/__tests__/SuggestInput.props.unit.test.tsx src/react/__tests__/components/default-agent-handles.test.tsx src/react/hooks/__tests__/useAgentHandle.test.tsx src/react/__tests__/components/PillButton.test.tsx src/react/__tests__/components/PopoverItem.test.tsx src/features/interactive-ui/providers/shadcn/__tests__/agent-handles.test.tsx src/features/interactive-ui/providers/shadcn/__tests__/checkbox-field.test.tsx src/react/__tests__/components/PopoverMenu.test.tsx src/features/interactive-ui/providers/shadcn/__tests__/select-field.test.tsx
pnpm --dir packages/admin exec vitest run src/react/entities/__tests__/entity-field.test.tsx
npm --prefix packages/ui run typecheck
npm --prefix packages/admin run typecheck
```

Chat: 129 affected Composer/folder/message-row tests passed; 58 final picker/tagging tests passed; 7 AttachmentTray tests passed. Chat typecheck/build and strict complexity 10 passed. An earlier eight-file affected run passed 174/175; the sole failure is listed below and was not hidden or weakened.

```sh
pnpm --dir packages/chat exec vitest run src/react/components/__tests__/Composer.agent-handles.test.tsx src/react/components/__tests__/MessageRow.test.tsx src/react/components/__tests__/FolderChips.agent-handles.test.tsx src/react/components/__tests__/Composer.test.tsx
pnpm --dir packages/chat exec vitest run src/react/features/chat-pane/__tests__/components/AgentRuntimePicker.agent-handles.test.tsx src/react/features/chat-pane/__tests__/components/AgentRuntimePicker.test.tsx src/react/components/__tests__/Composer.agent-handles.test.tsx src/react/features/chat-pane/__tests__/components/AgentRuntimePicker.native-policy.unit.test.tsx src/react/components/__tests__/FolderChips.agent-handles.test.tsx src/react/features/chat-pane/__tests__/components/AgentRuntimePicker.access-note-icon.unit.test.tsx src/react/features/chat-pane/__tests__/components/ChatPane.agent-handles.test.tsx
pnpm --dir packages/chat exec vitest run src/react/components/__tests__/AttachmentTray.test.tsx
pnpm --filter @jini-ai/chat run typecheck
pnpm --filter @jini-ai/chat run build
```

Exact earlier affected command with the baseline failure:

```sh
pnpm --dir packages/chat exec vitest run src/react/features/chat-pane/__tests__/components/AgentRuntimePicker.test.tsx src/react/components/__tests__/Composer.test.tsx src/react/components/__tests__/Composer.agent-handles.test.tsx src/react/components/__tests__/AttachmentTray.test.tsx src/react/components/__tests__/ComposerDiscovery.test.tsx src/react/features/chat-pane/__tests__/components/AgentRuntimePicker.agent-handles.test.tsx src/react/features/chat-pane/__tests__/components/ChatPane.agent-handles.test.tsx src/react/features/chat-pane/__tests__/components/ChatPane.test.tsx
```

All touched Jini production files were linted with explicit complexity and cognitive-complexity ceilings 10. No errors; one unchanged CustomSelect portalContainer type-alias warning. Exact command form (explicit production paths from this diff):

```sh
node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' <explicit touched production paths>
```

Exact UI/admin commands and results are retained in /workspace/.tovu-build/logs/tag-b-ui-validation-commands.md; chat logs use tag-b-chat-* there. No full repository suite completed and no coverage ratchet was run. An unintended desktop test hook was started by a redundant no-change Tovu push and was stopped to preserve job scope; no hook was changed or bypassed. Driver/component integration used jsdom; no full-application browser run is claimed.
## Tovu validation

Final refreshed-package evidence: 144 tests passed across nine files, then the isolated Site Key file passed all five tests, covering all ten affected files. The combined invocation reported a worker-start timeout for Site Key while an unintended unrelated desktop pre-push hook was running. That hook was stopped; the Site Key file passed with an isolated fork worker. No assertion, timeout threshold, hook configuration or rule was weakened. This includes direct backup/menu driver effects, users/media/taxonomy driving, secret reveal privacy, scoped menu portals with chat send excluded, App page identity and WebMCP wiring. Admin TypeScript passed without diagnostics.

```sh
# Working directory Tovu/apps/admin
npm test -- --run src/features/import-export/__tests__/GitBackupCard.unit.test.tsx src/features/menus/__tests__/MenuEditor.header-characterization.unit.test.tsx src/features/security/__tests__/SiteKeyTab.agent-secrecy.unit.test.tsx src/integrations/jini-admin/__tests__/kit.unit.test.tsx src/features/users/__tests__/users-agent-drive.unit.test.tsx src/features/media/__tests__/media-agent-drive.unit.test.tsx src/features/taxonomy/__tests__/taxonomy-agent-drive.unit.test.tsx src/__tests__/unit/app-agent-page-identity.unit.test.tsx src/__tests__/unit/app-hooks-admin-webmcp.unit.test.tsx src/components/__tests__/SecretInput.unit.test.tsx --maxWorkers=1 --pool=threads
npm test -- --run src/features/security/__tests__/SiteKeyTab.agent-secrecy.unit.test.tsx --maxWorkers=1 --pool=forks
node_modules/.bin/tsc -p tsconfig.json --noEmit
```

The old users test expected agent-addressable password/reveal controls, contradicting the approved secret policy already implemented in TAG-A. It retains its complete human edit/reveal/reset/cancel behavior proof and now additionally verifies no secret handles, refused agent fill/reveal, and no secret value in discovery after reveal. No test was skipped/deleted or assertion weakened to mask a failure.

Strict complexity 10 passes for all other touched Tovu production paths. App's unchanged AdminShell reports11 on both original-base and current source; listed below as instructed rather than broadened into unrelated refactoring.

```sh
# Working directory Tovu
node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' apps/admin/src/features/import-export/GitBackupCard.tsx apps/admin/src/features/menus/MenuEditor.tsx apps/admin/src/integrations/jini-admin/kit.ts apps/admin/src/App.tsx apps/admin/src/main.tsx
```

Baseline source was read from origin/cloud/combine:apps/admin/src/App.tsx and linted via stdin with --stdin-filename apps/admin/src/App.tsx under the identical config/rules. Both report complexity 11 for AdminShell. Raw evidence: /workspace/work/tag-b/tovu-App-baseline-complexity.log and tovu-complexity.log. Final tests/tsc logs: tovu-final-affected.log, tovu-final-sitekey-isolated.log and admin-after-rebuild-tsc.log in the same directory.
## Open findings and limits

BUG — Pre-existing chat interrupt-history remount test at ChatPane.test.tsx:1203 recalls first instead of accepted text. The unchanged chat source from origin/cloud/combine reproduces it with the same current dependencies and linked self dist (not an untouched full-tree baseline). No history/send behavior was modified to make it pass. Baseline SHA: 3a86f98ba03380651c8bf64b8fc18c4f90a122fd. It archived original packages/chat into /workspace/work/tag-b-chat-baseline and linked current node_modules/db/self dist. Exact baseline command from that archive's packages/chat: node /workspace/Jini/node_modules/vitest/vitest.mjs run src/react/features/chat-pane/__tests__/components/ChatPane.test.tsx -t 'shows and recalls an accepted interrupt'. Evidence: /workspace/.tovu-build/logs/tag-b-chat-baseline-interrupt.log.

BUG — Pre-existing Tovu no-change push hook starts desktop gates when no ref-update paths are available. Listed only; the redundant push was stopped, and normal changed-path pushes retain their hooks.

BUG — Pre-existing Tovu AdminShell cyclomatic complexity 11 exceeds 10; identical on base/current. No introduced complexity failure remains.

LIMIT — The inherited agentHandleProps helper can exceed 128 characters when a caller supplies a nearly 128-character explicit base and a child suffix is appended. Automatic handles and item segments added here are bounded. Listed only, not expanded into a global helper rewrite.

No required TAG-B implementation remains open. Full repository suites and any package release/deployment remain outside this job. The pre-existing untracked Jini packages/plugin-ui-ux-design directory was left untouched. No eslint-disable, type/coverage suppression, threshold reduction, test skip or rule weakening was introduced. Both repo diffs pass git diff --check.

## Cost and architecture

Architecture audit PASS: generic React identity/attributes, forwarding, privacy and portal mechanics stay in Jini; Tovu supplies the host attribute adapter and existing root wiring only. No product dependency was added to neutral packages. Existing approval/executor policies remain authoritative.

Added cost: each affected render constructs small local DOM attribute objects (estimated 80–250 bytes/control) and hashes mounted/item IDs in O(id length). Composite mapping is O(rendered items plus ID lengths); origin-page lookup is O(ancestor depth). One extra initial trigger-ref render is used by the shadcn portal seam. Each duplicate-action refusal emits one local warning. Existing discovery remains O(active descriptors and ancestor checks) with the existing 64 KiB transport cap and query filters. Added service reads/writes/polling/tables: zero.

Reports contain the implementation/checkpoint commit ledger below. The final report commit is named in the final delivery message because a commit cannot contain its own SHA. Every listed commit and the final report commit are pushed only to cloud/tag-b.

## Commit ledger — Jini

```text
e39166479cf29a83df239abe010ced3485b6b3a5 docs: record tag-b scope and combined base
14210c73445c01a3d25e57e6296a8c90c1c21044 feat(ui): tag shared controls with stable default handles
5354a0d22629c3ce364f1aaaec22c4d35fef7f72 feat(chat): default composer and runtime picker agent handles
369daf83bf9cd83f27a0df13b04bb65db663a29f fix(agentic): warn when duplicate handles refuse an action
3ce2828bc73536d756b06fc96985af727f7b9277 feat(ui-kit): default shared control handles and forward composite leaves
ee3e9583ddb6371d667a26c1b8b4fc82e5c94fd6 feat(ui): preserve field handles through shadcn and entity controls
9dc44e28ba3d13bf4e71f24c4ae6970abc32746c test(chat): verify pane handle forwarding and keep tray opt-out
761e64c237782eb8bc3608c075e56e83dc05ce84 fix(ui-kit): preserve opt-outs and metadata across native forwarding
cbea94d3ca318faffa0b98b35406dc874d26f69a feat(ui): default existing widget and tab controls to agent handles
57488eefc4aabc9cb53a239a9844fa240f2a229e test(chat): preserve attachment handle identity across reorder
82b94c528f827142804aa45d4551a005b99b16df fix(ui-kit): keep tab identities stable and preserve generated defaults
8042f6be0937e310a60865a9a09132e2798da7b7 fix(chat): forward composer handles to folder controls
fa50039d04165a6ae7ac448279cec1ac97d05e4b feat(ui-kit): tag ordinary confirmations while preserving human-only decisions
5dbce5e5048d3fb3141774eefe60b12664b08f65 docs: checkpoint tag-b delivery and baseline findings
682510abec1d49cdb368e01b406c07863ef372fe fix(ui-kit): retain composite privacy before leaf opt-outs
5cd2c729b4fe9f7545bfcf40b909175e6051534c fix(chat): retain runtime picker portals in host overlay roots
1ee226e3dd60af8888b027d4f2cb52f12c3d3d13 test(chat): verify picker portal boundary and native dialog priority
4024f7a50063c11cef4ff292e82e9d64c15c4aca fix(ui): keep select overlays within the scoped host
d4777af8355082c9b94b7f9007f9ab1733fe057f fix(ui): keep filtered option identities stable
```
