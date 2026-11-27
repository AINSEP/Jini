# r62-ttq-j3 Jini commit plan

Base `a9f58d6bcf69d817876d165992ef29aa8d2c8c6a`. Leave this handoff uncommitted. The order below is for the coordinator. Mutations are instructions for the cloud run, not changes in this tree.

## 1. Pin user-management review behaviors

Files

- `packages/user-management/src/__tests__/package-entries.test.ts`
- `packages/user-management/src/admin-http/owner/__tests__/y5-passkey-admission.test.ts`
- `packages/user-management/src/identity/__tests__/tool-registrations.identity-authorization.test.ts`
- `packages/user-management/src/identity/sql/__tests__/kernel-user-trash-store.test.ts`
- `packages/user-management/src/member-login/__tests__/bundled-providers.test.ts`

| Test | Entry | Mutation | Assertion that should fail |
|---|---|---|---|
| Every published entry | F2.4 | Redirect all three `./identity/sql/kernel-user-trash-store` export targets to `user-trash-adapter`. | The exact manifest object no longer matches. The separate source-binder assertion is retained. |
| Mounts status and five actions | F4.4 | Remove the owner-ID comparison in `ownerPasskeyStatusRoute`, leaving only the session-kind check. | The non-owner session reaches `passkeyDeps` instead of returning the exact non-owner JSON. The tool-owner case still checks the disjoint kind gate. |
| Binds request admission and delegates sign-in | F3.6 | In `execute`, replace forwarded `pendingToken` with `''`. | The single login port call no longer contains `pending-1`. |
| Binds request admission and delegates sign-in | F2.4 | Delete the expected-error `json(...)` in `answerOwnerPasskeyFailure`. | The missing-store login no longer sends the exact 400 response. The separate thrown-store incident still has its original assertions. |
| A non-owner cannot enable the protected owner account | F4.5 | Skip `assertUserAccountAction` for a disabled target on the enable route. | Seeding the target disabled exercises the bypass and does not produce the exact owner-only refusal. |
| The real service rechecks authority lost during human approval | F4.4 | Pass `callerPrincipalId: ''` in the role-delete `prepare` authorization. | The approval counter is zero even if the early exception has the same class, permission and reason. The role must still be read back unchanged. |
| An outbox failure rolls back the disabled marker and session revocation | F2.6 | Swallow the rejected `.execute()` in `appendEvent`, for example by adding `.catch(() => undefined)` to it. | The trigger rejects the real insert, but `hide` no longer rejects when the insert error is swallowed. Both table read-backs still pin rollback in the real path. |
| Hide disables and revokes sessions, and restore uses status CAS | F1.3 | Remove the workspace predicate or, independently, the principal predicate from `revokeSessions`. | The sorted remaining rows lose the same-principal session in the other workspace or the other-principal session in the same workspace. |
| Hide disables and revokes sessions, and restore uses status CAS | F6.1 | Set `restoredStatus` to `'disabled'` unconditionally. | The post-race successful restore no longer reads back `{ status: 'active', disabled_at: null }`. The stale CAS check and exact session read-backs remain. |
| Loads bundled descriptors before installed admission | F2.6 | Set the contribution's `parse` to an always-refusing parser. | The loader now runs that parser and the refusal fails the test before mapping. The digest is pinned to the independently specified canonical preset. |
| Loads bundled descriptors before installed admission | F4.3 | Delete the `continue` on manifest refusal. | The source-loader calls contain the blocked source rather than only `/bundle/plugin`. |

## 2. Reject duplicate runtime metadata declarations

Files

- `scripts/__tests__/m26si-export-metadata.test.ts`
- `packages/cms/package.json`
- `packages/core/package.json`

F5.6 has five independent table cases. For each entry below, add an earlier `"node"` declaration while keeping the existing `"universal"` declaration. That case should see `['node', 'universal']` instead of `['universal']`. Duplicate `"universal"` values also fail the singleton check.

- CMS `./core/days-remaining`
- CMS `./admin-http/routes/external-mcp/provider-refusal`
- CMS `./publish/content/peer-transport-error`
- CMS `./publish/trust/handshake-error`
- Core `./contracts/standing-draft`

## 3. P26 empty AG-UI stream

Files

- `packages/chat/src/core/assistant-client/__tests__/ag-ui-transport.test.ts`
- `packages/chat/src/core/assistant-client/ag-ui-transport.ts`

- Empty stream test mutation: revert the `complete` message or resolve start with a run ID. The exact rejection assertion fails. Separately remove `forgetRun({ turn })` from the pre-start rejection branch. Stopping the ID recorded by the agent then calls `abortRun`, which fails the cleanup assertion. Late notifications must not call either handler.
- Started-but-incomplete stream test mutation: revert the `complete` message. The exact `onError` message fails. The existing error-before-done and partial transcript checks remain.
- LEFT: `isAgUiRunId` cannot return false for the minted prefix under a message-only change. It classifies IDs for reattach, status and stop routing even after completion. The cleanup assertion uses `stopAgUiRun` to observe the actual in-flight registry. The prefix contract was left intact.

## 4. Match the site-share registry miss contract

Files

- `packages/devops/src/backup/site/__tests__/share-backend.test.ts`
- `packages/devops/src/backup/site/__tests__/share-expiry.test.ts`
- `packages/devops/src/backup/site/share-backend.ts`

`SiteShareRegistry.get` already returns `null`. Its backend interface and the two existing test doubles now agree. This is a type-only production fix and no test bodies or assertions changed. Reverting the port to `undefined` should fail assignability for the concrete registry and the typed null-returning doubles. No Tovu caller change identified. Its concrete subclass inherits `null` and the download handler checks `!row`.

## 5. Discriminate peer publish destinations

File `packages/devops/src/deploy/site/static-publish/publish-history.ts`.

Use ``"peer" | `${string}-peer` `` for the peer branch and its projection input. The peer discriminant no longer overlaps `static` or `deploy`. The ledger predicate, ID and wire kind still use the same injected literal. Reverting the peer branch to `string` makes the `deploy` guard unable to narrow reads of `linkedPeerId` and `status`, as used by Tovu's existing tests.

The Tovu `publish-site.ts` route already passes the `"tovu-peer"` literal. On Tovu `codex/m27`, the callers below already omit the existing required `peerKind` from `new InMemoryPublishHistoryStore`. The two files marked `list` also omit it from `listPublishDestinations`. Pass `peerKind: "tovu-peer"` at those call sites. These are pre-existing omissions, not new wire incompatibilities. `codex/m27t` already supplies the literal in its static-publish history test.

- `apps/website/src/features/deployments/__tests__/publish-agent-tools.unit.test.ts`
- `apps/website/src/features/deployments/deploy-ops/__tests__/deploy.test.ts` (list)
- `apps/website/src/features/deployments/deploy-ops/__tests__/extract-s9-g-deploy.support.ts`
- `apps/website/src/features/deployments/static-publish/__tests__/domain-publish-tool.unit.test.ts`
- `apps/website/src/features/deployments/static-publish/__tests__/publish-history.unit.test.ts` (list)
- `apps/website/src/features/deployments/static-publish/__tests__/publish-run.unit.test.ts`
- `apps/website/src/server/inbound/admin-http/routes/system/__tests__/publish-site-listing.unit.test.ts`

## 6. Unregister widget resolvers

Files

- `packages/cms/src/widgets/__tests__/unit/resolvers-core-wiring.unit.test.ts`
- `packages/cms/src/widgets/resolvers/index.ts`

For the unregister case, remove the backing-map deletion. Real `resolveWidgetType` still renders the menu instead of returning `resolver-error`. Separately remove the once guard. Calling the old unregister a second time removes the later registration of the same resolver, so the real menu result no longer matches. Both registrations are cleaned up. Existing callers can ignore the return value.

## Scope and handoff

- All 12 review rows were confirmed by source inspection. No newsletter or sibling tests changed. The two new test declarations are the extracted empty-stream case and the widget unregister case. No tests deleted.
- Deletions after diff review are the five duplicate manifest declarations and the pre-SQL throwing encoder mock with its no-longer-needed fixture handle. The weak check replacements retain or strengthen the earlier contracts.
- Author Checklist applied by source inspection to each changed case. Fixtures distinguish the named branches, expected values are independent, calls are used only for port/handler contracts, persisted output is read back, and the SQLite spy and widget registrations are restored. No tests, mutations, builds, installs, linters or typechecks were run per dispatch. Runtime verification goes to Opus.
- No new subpaths or export names. Existing contracts change at `@jini-ai/devops/backup/site/share-backend`, `@jini-ai/devops/deploy/site/static-publish/publish-history` and `@jini-ai/cms/widgets/resolvers`.
