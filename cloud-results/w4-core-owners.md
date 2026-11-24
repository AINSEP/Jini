PARTIAL 71247e39f0 6d9138968: left = 8 owner decisions (publish-ports bag, content kernel K4-seam-5, secret sealer/keyring owner, execution-card types, cms→agentic edge, comments provider registries, AdminExecutionMode/origin adapter, publish-content-ui K5 prerequisite) — see "STOP: owner decisions"

# w4-core-owners — neutral Jini Core owners for the items that blocked wave-3 lanes (2026-11-24, unattended)

- **Branches:** Jini `codex/w4-core-owners-jini` (code tip `6d9138968`), Tovu `codex/w4-core-owners-tovu` (code tip `71247e39f0`). Plain `git push`; never forced.
- **Base:** `origin/integ/merge-16-2026-11-23` (Jini `7490405a`, Tovu `3a9332247`). Re-fetched before the final push: 0 new commits on the train, so there was nothing to merge.
- **Programmer skills:** I read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) before any work. Its rules went into the shared builder brief:
  - verbatim moves
  - an honest test per owner
  - pre-completion evidence
  - fresh gate runs against a base worktree
- **Method:**
  - Opus coordinated and chose each owner and port design.
  - 5 Sonnet subagents (high effort, ≤4 at a time) did the verbatim moves and import rewrites. They never committed.
  - The coordinator reviewed each diff, committed per batch and pushed WIP about every 10 min.
  - I could not run the Codex review in this session. **Every diff below still needs Codex review before the train merges it.**
- **Setup:**
  - Node 24.22.3 and pnpm 10.33.2.
  - Jini: `pnpm install --frozen-lockfile` and `pnpm -r build` both exit 0.
  - Tovu: `npm ci --ignore-scripts` in the root and `apps/{admin,desktop,site-chat}`, then `link-jini.mjs` (`JINI_PACKAGES_DIR=/home/user/Jini/packages`). `packages/contracts` and `packages/sdk` tsc exit 0.
  - **Base worktrees:**
    - Jini `/home/user/jini-base` at merge-16 has its own install and build.
    - Tovu `/home/user/tovu-base` has its own `@jini-ai/*` links to jini-base, so base gates never saw this branch's Jini.

## Owners created (all in `@jini-ai/core`; definitions moved verbatim; old files deleted; importers repointed; no forwarding files)

| owner | definitions moved | importers repointed | unblocks (w3 lane + step) | tests |
|---|---|---|---|---|
| `@jini-ai/core/tool-metadata/post` | Tovu `contracts/core/tool-metadata/post.ts` (whole file; only the import specifiers changed, plus the `./index.ts` → "host aggregator" pointer, as in precedent `ea2cb094`) | 4: the tool-metadata `index.ts` aggregator, `post/tool-registrations.ts`, `post/preview-tool.ts`, `post/content-stats-tool.ts` | **w3-content** "`tool-metadata/post`": `preview-tool`, `content-stats-tool` and the post tool-registration declarations can move to cms. `post-tool-schemas` is still held by R5. | new `core/src/tool-metadata/__tests__/post.test.ts` (3, pins every post approval class); Tovu post tool tests 8 files green (preview 11, content-stats 13, guards 16, author 4, delete-confirmation 4, assistant post registrations 38) |
| `@jini-ai/core/tool-metadata/image-transform` | Tovu `contracts/core/tool-metadata/image-transform.ts` (same treatment) | 2: aggregator `index.ts`, `image-transform/tool.ts` | **w3-content** "image-transform tool" (the attachment-runtime group). Its metadata owner was the missing piece. | `image_transform` pinned in `post.test.ts`; Tovu `image-transform` tool 13, codec 3 green |
| `@jini-ai/core/tool-access-change` (outside `contracts/`, because the class is a runtime value, XP4) | `NotifyToolAccessChanged` and `ToolAccessLoweringError` from Tovu `contracts/core/tool-access-change.ts` (deleted) | 15 import lines. 2 **forwarding re-exports removed** (`assistant/external-mcp-roster-change.ts`, `modules/assistant-tool-access-lowering.ts`), and their 7 importers now point at core. | **w3-addons** "ToolAccessLoweringError to core": `agent-plugins/set-enabled.ts`, `plugin-runtime/lower-tool-access.ts` and `assistant/external-mcp-roster-change.ts` no longer need a host import for the error/effect type. Their route-deps fields stay with the routes lane. | new `core/src/__tests__/tool-access-change.unit.test.ts` (instanceof, code, exact message); Tovu green: roster-change 5, tool-access-lowering 2, set-enabled lowering 2, lower-tool-access 1, extract-s7 9, external-mcp registrations 42 |
| `@jini-ai/core/contracts/site/daemon-http` gains the **run-attachment port** | `AttachmentStore` (the whole port, with every doc comment) from daemon `http/attachment-store-types.ts`; `AttachmentClaim` from daemon `http/attachment-types.ts`. Daemon keeps `CreateDiskAttachmentStoreOptions` and all runtime (`AttachmentRejectedError`, `isUnchangedAttachment`, the disk store). **`@jini-ai/daemon/http` no longer exports the two types** (changeset `.changeset/w4-core-owners.md`, api-baseline updated). | Jini: 4 daemon sources and 6 daemon tests. Tovu: 5 files (`agent-daemon-scope`, `-run-start`, `-scope-attachments`, the attachment-run-fields test, `media/promote-chat-attachment`). Lines that also take runtime values were split, so the runtime import stays on daemon. | **w3-content** "daemon attachment runtime" (`promote-chat-attachment`, `read-chat-attachment`, `library-save-attachment`, `view-video-tool`). This is the recommended "run-attachment lookup port next to Core `daemon-http`". cms can now type `ChatAttachmentLookup = Pick<AttachmentStore,'resolveForRun'>` without a daemon edge. The wave-5 move must **inject** `AttachmentRejectedError`-detection / `isUnchangedAttachment` / `prepareMessageAttachments`, per the owner's "inject everything" rule. `CHAT_ATTACHMENT_REF_PATTERN`'s owner is on w3-fnd (below). | new `core/src/__tests__/attachment-store-port.unit.test.ts` (3, `expectTypeOf` on `resolveForRun`/`claim`/`listPendingForOwner`, plus fake-lookup assignability); daemon `src/http` 67 files / 2169 tests green; Tovu promote 11, read 37, list-pending 10, run-fields 12 green |
| `@jini-ai/core/optimistic-concurrency` gains `SaveConflict` | `SaveConflict` from Tovu admin `lib/version-conflict.ts`. Tovu's duplicate `VERSION_CONFLICT_CODE` was deleted, so core's identical constant is now the only one. `isVersionConflict`, `readVersionConflict` and `VERSION_CONFLICT_MESSAGE` stay in the host because they use the host `ApiError`. | 3 (`pages/rules.ts`, `posts/rules.ts`, the version-conflict test). `version-conflict.ts` imports from core for its own use and does not re-export. | **w3-pages-members** "`page-editor-port.hooks.ts` / `page-editor-save.ts` need a core page/post row contract (AdminPost, SaveConflict)". `SaveConflict` is now in core. `AdminPost` already has a Jini owner on **w3-content** (`@jini-ai/admin` `posts/api/posts-api.types.ts`), so no new `AdminContentRow` contract is needed (that would duplicate it). The move injects `readVersionConflict`. | new `SaveConflict` case in core `optimistic-concurrency.test.ts` (24 green); admin: version-conflict, PageEditor, PostEditor, use-page-editor, 391 green |
| `@jini-ai/core/contracts/hosted-mcp` gains `hosted-mcp/admissions.ts` | 7 admin wire types from Tovu admin `integrations/api/integrations-api.types.ts`: `AdminRemoteToolAnnotations`, `AdminToolRefusalReason`, `AdminRemoteToolSurfaceEntry`, `AdminExternalMcpProbeResult`, `AdminFederatedAdmissionEntry`, `AdminExternalMcpConfigFailure`, `AdminExternalMcpAdmissionsSnapshot` | 12 (`integrations-api.ts`, the 2 settings rules, 2 hooks, 7 tests) | **w3-settings** A-K2-integrations-1 (`external-mcp-admissions-rules.ts`, `external-mcp-tool-picker-rules.ts`, `use-external-mcp{,-admissions}.hooks.ts`, `use-external-mcp-tool-picker.hooks.ts`, `ExternalMcpAdmissionsBanner`, `ExternalMcpToolsModal`). `ExternalMcpSettingsPanel{,.hooks}` still needs `useWiredSourceConfigAddForm` from `@jini-ai/ui` (an admin→ui L1 edge, so it gets injected at the move). | new `core/src/__tests__/hosted-mcp-admissions.unit.test.ts` (2, pins the 7 literals and `refused[].reason`); admin `features/settings` + api-admissions: 31 files / 529 green |

**Why-comments:**
- Tovu: 2 debt rows were added (`b0f918a73686`, `d9da48651fdc`) for the reworded `./index.ts` pointer in post/image-transform. They use the exact precedent form of the `pages`/`navigation` rows. No other lost block was introduced.
- All other moved comments moved verbatim into the Jini owners.

## Already owned on a sibling w3 branch (not duplicated here; unblocked once the train merges that branch)
- `CHAT_ATTACHMENT_REF_PATTERN` / `contracts/headless/chat-attachment` (w3-content): **w3-fnd** core `contracts/headless/chat-attachment.ts`.
- `human-confirm` (w3-content): **w3-addons** core `contracts/site/human-confirm.ts`.
- `AdminAgentPlugin` core contract (w3-addons): **w3-rtfnd** core `contracts/site/cms-agent-plugins.ts` (`AdminAgentPluginDto` and its envelopes).
- K4-seam-20 hosted-MCP OAuth types (w3-addons `external-mcp/deps.ts`): **w3-fnd** core `contracts/site/api-connections-hosted-mcp.ts`.
- `PostRecord`/`PostRepoPort` (w3-addons `email-templates/*`): **w3-content** `@jini-ai/cms/posts/post`.
- `AdminPost` (w3-pages-members): **w3-content** `@jini-ai/admin` posts-api.types.
- `TransformParams` (w3-deploy site-backup, K4-seam-13): already on merge-16 in core `contracts/site/cms-media.ts`, so that part of the site-backup chain is unblocked now.

## STOP: owner decisions (not built; my recommendation in each)
1. **Publish ports bag** (`TovuPublishPorts`; blocks w3-content `*/publish-content.ts` and `verify-published-media`).
   - Core cannot own it. It is made of cms, user-management and host-theme port types (Core may not import cms), and the bag is per-product by definition.
   - **Rec:** each cms publish handler exports its own port slice (`FormPublishPorts = { repo: FormDefinitionRepoPort }`, …) next to the handler in `@jini-ai/cms/<feature>`. The host bag stays in Tovu as the intersection of those slices. `theme-files`/`active-theme` stay host (theme freeze).
2. **Content kernel / `ContentDatabase` (K4-seam-5)** (blocks w3-content `repo.sqlite`/search-index/sweeps; w3-settings consent/site-search/settings/redirects repos; w3-users-sec K5-identity repos).
   - A Core port typed in Kysely would put a vendor type in Core.
   - **Rec:** a Core `QueryKernelPort` over compiled SQL (`{ query({sql, params}), execute({sql, params}) }`, no Kysely types), with `@jini-ai/db` providing the Kysely adapter.
   - Alternative: approve the `cms → @jini-ai/db` edge. cms already depends on `kysely`.
3. **Secret sealer/keyring owner** (blocks w3-deploy `CredentialProjectHalf`/X-vendor-credentials-1 and w3-addons webhook sealer).
   - `CredentialProjectHalf` needs `SecretSealerPort`/`KeyringPort`, which live in integrations.
   - **Rec:** as w3-addons proposed, `@jini-ai/platform/secrets` owns the sealer/keyring ports. Then `credential-scope` (types plus `credentialScopes`/`credentialCreateTarget`) moves to `@jini-ai/integrations`.
4. **Execution-card types** (w3-settings `ai-agent-presentation*`; w3-sites `AdminExecutionMode`).
   - The ui `DetectedAgent`/`ExecutionPort`/`ExecutionConfig` (27 exports) clash with Core's differently shaped `DetectedAgent`.
   - **Rec:** move them as one unit to `@jini-ai/core/contracts/execution`, renaming the ui shape `ExecutionCardAgent` so Core never has two `DetectedAgent`s.
   - Add the kit slot and `data-jini-local-cli` for `AdminExecutionMode`, as w3-sites recommended.
5. **`@jini-ai/agentic` as a cms dependency** (w3-content forms/widgets capability-card). **Rec:** inject the card builder (owner rule "inject everything"); no new package edge.
6. **Comments provider selection/settings/builtin-provider** (w3-content). These need capability-provider, cookie-consent and user-management registry ports. **Rec:** owned by `@jini-ai/capability-providers` (a registry port), not Core. It needs its own design step.
7. **`criteria-publish-result.ts` dialog contract** (w3-deploy). It is not a Core-owner gap: it imports `@tovu/publish-content-ui`, so it waits on K5-publish-content-ui-1 (and K5-publish-content-1, K4-publish-content-2, K4-seam-21).
8. **w3-sites origin adapter**: **Rec:** inline the binding in `site-deps/events-origin.ts`, call core `resolveConfiguredOrigin` directly, and delete the adapter (the w3-sites rec stands).

## Unblocked for wave 5 (by lane and step)
- **w3-content:**
  - post tool moves (`preview-tool`, `content-stats-tool`, the post tool-registration metadata)
  - `image-transform` tool
  - chat-attachment tools (`promote-/read-chat-attachment`, `library-save-attachment`, `view-video-tool`): the port is ready now; `CHAT_ATTACHMENT_REF_PATTERN` arrives when w3-fnd merges. Inject the daemon runtime values.
- **w3-addons:** the `ToolAccessLoweringError` users (`set-enabled`, `lower-tool-access`, `external-mcp-roster-change`). `AdminAgentPlugin` (w3-rtfnd), K4-seam-20 (w3-fnd) and `PostRecord`/`PostRepoPort` (w3-content) are unblocked once those branches merge.
- **w3-pages-members:** `page-editor-port.hooks.ts` and `page-editor-save.ts`: `SaveConflict` is in Core now, `AdminPost` comes with w3-content, and `readVersionConflict` gets injected.
- **w3-settings:** A-K2-integrations-1, the ExternalMcp rules, hooks, banner and modal. The panel needs `useWiredSourceConfigAddForm` injected.
- **w3-deploy:** the site-backup `TransformParams` dependency is already met (merge-16 core).

## Self-check (before every push)
- **No re-export/forwarding files.** Two pre-existing Tovu forwards were *removed*. The only new `export … from` line is Core's own `hosted-mcp.ts` aggregator line. The daemon barrel diff is removals only.
- **No server-framework or vendor types in Jini:** grep of the diff is clean.
- **No new size-exception entries:** size gate identical to base.
- **Why-comments moved with the code** (2 precedent-form debt rows; see above).
- **api-baselines:** updated for every new Core export (`api-baseline/jini-ai__core.json` +12 symbols and 3 subpaths) and for the daemon removal. Changeset: `.changeset/w4-core-owners.md`.
- **Shared JSON:** Core `package.json` exports and inventory are additive only. `why-comments-debt.json` was union-inserted.

## Gates (base = merge-16 worktrees; outputs in the session scratchpad)
| gate | base | final |
|---|---|---|
| Jini build | 0 | 0 (0 `error TS`) |
| Jini typecheck / api:check / check:hooks | 0 / 0 / 0 | 0 / 0 / 0 |
| Jini guard | exit 1, 28 lines | identical (content diff empty) |
| Jini XP (`check:cross-package`) | 2945 XP lines | 2945, identical. Two new type tests first landed under `contracts/` (+15 XP4) and were moved to `core/src/__tests__/` (`6d9138968`). |
| Jini size / complexity / log-safety | exit 1 (ratchets) | identical content |
| Jini why-comments | 377 lost / 367 allow-listed | 377 / 367 |
| Jini changed vitest | — | core: all 237 files / 3040 green; daemon `src/http`: 67 / 2169 green |
| Tovu `tsc -p tsconfig.json` / admin tsc / `tsconfig.tests.json` | 0 / 0 / 0 errors | 0 / 0 / 0 errors |
| Tovu why-comments | 879 lost / 801 allow-listed (78 red) | 881 / 803 (78 red, same) |
| Tovu admin vitest (changed files and importers, `--maxWorkers=2`) | — | 92 files / 3572 tests green |
| Tovu website node tests (changed files and importers, one file at a time) | — | 250 files: 241 green, 9 red. **All 9 are red on the base worktree too:** forms-notification-retry, forms-notification-restart, outbox-worker, bundled-ui-ux-design-package, database-transfer postgres (no PG), webhooks tool-contract.characterization, plugin-host.integration, process-root-parity, assistant-byok.inputs-pin. |

## Commits
- **Jini:**
  - `7fee833cb` wip (owner moves)
  - `5fa3f1ba7` changeset
  - `8d13e2740` hosted-mcp admissions
  - `1477f86e5` api baselines
  - `6d9138968` type tests out of `contracts/`
  - plus this report's copy
- **Tovu:**
  - `822bdd9c60` and `046dec189d` owner moves
  - `7d96eea136` and `05925736d1` D/E importers
  - `71247e39f0` why-comment rows
  - plus this report
