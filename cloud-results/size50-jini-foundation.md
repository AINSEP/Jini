# size50-jini-foundation report

Branch: `refactor/size50-jini-foundation` (from origin/integ/wave-b). All 38 plain functions of 51..80 lines in the listed packages were split to <=50 lines (eslint max-lines-per-function, skipBlankLines/skipComments); complexity <=10 verified with eslint `complexity`. Re-running the scan afterwards finds none left in 51..80.

Skip list (files changed on origin/refactor/size-jini-rest): none of them held a candidate.

## Function list
| lines | location | function | status |
|---|---|---|---|
| 52 | packages/core/src/approval.ts:118 | createApprovalHandler | DONE |
| 51 | packages/core/src/approval.ts:200 | createBatchApprovalHandler | DONE |
| 68 | packages/core/src/approval.ts:260 | createApprovalProposalStore | DONE |
| 57 | packages/core/src/batch-tool-inputs.ts:298 | withBatchInput | DONE |
| 56 | packages/core/src/fetch/cache.ts:125 | load | DONE |
| 62 | packages/core/src/provider-registry.ts:111 | createProviderRegistry | DONE |
| 61 | packages/core/src/settings/agent-tools.ts:159 | getSettingsAgentToolCatalog | DONE |
| 61 | packages/core/src/settings/express/cms-adapter.ts:16 | createCmsSettingsService | DONE |
| 77 | packages/core/src/settings/express/stream.ts:17 | (anonymous arrow) | DONE |
| 66 | packages/core/src/settings/purge-service.ts:58 | (anonymous arrow) | DONE |
| 73 | packages/core/src/settings/write-service.ts:336 | (anonymous arrow) | DONE |
| 72 | packages/core/src/settings/write-service.ts:450 | (anonymous arrow) | DONE |
| 55 | packages/core/src/settings/write-service.ts:732 | (anonymous arrow) | DONE |
| 66 | packages/core/src/settings/write-service.ts:838 | (anonymous arrow) | DONE |
| 62 | packages/core/src/settings/write-service.ts:97 | (anonymous arrow) | DONE |
| 63 | packages/db/src/data-modules/data-module.ts:944 | (anonymous arrow) | DONE |
| 80 | packages/db/src/kernel/kernel-core.ts:89 | buildKernel | DONE |
| 53 | packages/db/src/kernel/store-copy.ts:294 | (anonymous arrow) | DONE |
| 67 | packages/db/src/pglite/owner.ts:429 | (anonymous arrow) | DONE |
| 76 | packages/db/src/tools/read-tools.ts:27 | createDatabaseReadTools | DONE |
| 64 | packages/devops/src/dns/node/resolver.ts:101 | createNodeAuthoritativeDnsResolver | DONE |
| 51 | packages/http-kit/src/rate-limit.ts:75 | createRateLimiter | DONE |
| 54 | packages/http-kit/src/raw-sse.ts:47 | createSseResponse | DONE |
| 52 | packages/integrations/src/api-connections/hosted-mcp/sign-in.ts:838 | (anonymous arrow) | DONE |
| 74 | packages/integrations/src/credentialed-http/tools/tool-registrations.ts:610 | createCredentialSaveHandlers | DONE |
| 53 | packages/integrations/src/media-providers/dispatch/providers/imagerouter-video-async.ts:112 | createImageRouterVideoPollingAdapter | DONE |
| 58 | packages/integrations/src/media-providers/task-store.ts:114 | createInMemoryMediaTaskStore | DONE |
| 65 | packages/integrations/src/webhooks/delivery.ts:342 | (anonymous arrow) | DONE |
| 67 | packages/platform/src/fs/directory-registry.ts:22 | createDirectoryRegistry | DONE |
| 56 | packages/platform/src/fs/directory-running-lock.ts:23 | createDirectoryRunningLock | DONE |
| 59 | packages/platform/src/fs/durable-json.ts:61 | createDurableJsonFile | DONE |
| 67 | packages/platform/src/http/guarded/transport.fetch.ts:26 | (anonymous arrow) | DONE |
| 51 | packages/platform/src/http/guarded/transport.fetch.ts:47 | (anonymous arrow) | DONE |
| 52 | packages/platform/src/terminal.ts:270 | (anonymous arrow) | DONE |
| 64 | packages/server/src/compose-jini-kernel.ts:342 | (anonymous arrow) | DONE |
| 52 | packages/server/src/host-bootstrap.ts:145 | installGracefulShutdown | DONE |
| 73 | packages/server/src/kernel-base.ts:135 | (anonymous arrow) | DONE |
| 63 | packages/sidecar/src/supervision/supervisor-node.ts:217 | createNodeIpcChannel | DONE |

## Commits (one per file)
```
c0b151c9 refactor(size): split createDatabaseReadTools (drop unused readers) under 50 lines
972fb7f6 refactor(size): split createNodeIpcChannel under 50 lines
b06199b8 refactor(size): split createJiniKernelBase under 50 lines
d9a90ad0 refactor(size): split installGracefulShutdown under 50 lines
65271dc2 refactor(size): split composeJiniKernel under 50 lines
11854c13 refactor(size): split terminal create under 50 lines
446bc7d0 refactor(size): split requestPinned under 50 lines
115b5569 refactor(size): split createDurableJsonFile under 50 lines
4e74574e refactor(size): split createDirectoryRunningLock under 50 lines
9f6fe5af refactor(size): split createDirectoryRegistry under 50 lines
06074faa refactor(size): split attemptOneDelivery under 50 lines
d4f4a9ba refactor(size): split createInMemoryMediaTaskStore under 50 lines
d5d1b389 refactor(size): split createImageRouterVideoPollingAdapter under 50 lines
69d3333c refactor(size): split createCredentialSaveHandlers under 50 lines
46f0f75a refactor(size): split beginConnect (device-code branch) under 50 lines
6314f647 refactor(size): split createSseResponse under 50 lines
46cf9ee7 refactor(size): split createRateLimiter under 50 lines
c9830692 refactor(size): split createNodeAuthoritativeDnsResolver under 50 lines
f6bbe2c9 refactor(size): split createDatabaseReadTools under 50 lines
d764003e refactor(size): split startPgliteOwner under 50 lines
82d7c37c refactor(size): split copyPgStoreInternal under 50 lines
2002524a refactor(size): split buildKernel under 50 lines
b94c6b79 refactor(size): split declareDataModule under 50 lines
34b57a58 refactor(size): split retypeDefinition under 50 lines
e67c42cc refactor(size): split renameDefinition transaction arrow under 50 lines
639dcebb refactor(size): split set and clear under 50 lines
9d8336ed refactor(size): split registerDefinitions under 50 lines
7b5b4062 refactor(size): split purgeTenantSettings under 50 lines
76817125 refactor(size): split openSettingsChangeStream under 50 lines
ba5847d6 refactor(size): split createCmsSettingsService under 50 lines
1b336918 refactor(size): split getSettingsAgentToolCatalog under 50 lines
1cd06251 refactor(size): split createProviderRegistry under 50 lines
0abcc4c7 refactor(size): split FetchCache.load under 50 lines
da9a172d refactor(size): split withBatchInput under 50 lines
ca529f43 refactor(size): split createApprovalHandler, createBatchApprovalHandler, createApprovalProposalStore under 50 lines
```

## Notes
- In `write-service.ts` the in-scope item was the 55-line async arrow inside `renameDefinition` (the parent was 86 lines); `retypeDefinition` also split. Same for `transport.fetch.ts` (`requestPinned` + its 51-line arrow) and `beginConnect` (inner method of an out-of-scope 201-line parent).
- Out-of-scope parents (>80 lines: createHostedMcpSignInService, createCredentialToolRegistrations, createTerminalService) were not touched beyond the extracted inner functions.

## Pre-existing failures (also fail on origin/integ/wave-b)
- `packages/db`: `src/__tests__/loads-without-driver.test.ts` (7 tests) and `security-defaults.source.test.ts` (1): 8 failures, identical on base.
- `packages/http-kit`: `src/__tests__/sse.test.ts` 'defaults maxQueuedEvents to 1000'; http-kit `tsc` build fails on stale test imports (also on base).
- `db`, `devops`, `integrations`, `server`, `http-kit`: `tsc --noEmit` errors only in `__tests__` files, unchanged by this work.
- `integrations/.../extract-s8-sets.unit.test.ts` failed once mid-run (dist being rebuilt), passes on re-run: flaky.

All other touched-file package tests passed.
