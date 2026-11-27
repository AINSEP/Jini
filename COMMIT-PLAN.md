# Commit plan for TTQ r62-ttq-j2

Working tree only. The review did not prescribe commit titles, so the list uses package-scoped commits in review order. Exclude this file from every commit.

1. `test(cms): close TTQ characterization gaps`
   - `packages/cms/src/media/site-import/__tests__/bindings.test.ts`
   - `packages/cms/src/media/site-import/__tests__/tool-registrations.test.ts`
   - `packages/cms/src/media/site/__tests__/import-video-conversion.test.ts`
   - `packages/cms/src/media/site/__tests__/provider-credential-store.test.ts`
   - `packages/cms/src/media/site/__tests__/publish-content.test.ts`
   - `packages/cms/src/navigation/site/__tests__/publish-content.test.ts`
   - `packages/cms/src/public-http/http/site/__tests__/render.golden.characterization.test.ts`
   - `packages/cms/src/public-http/routes/site/pages/handlers/__tests__/post.test.ts`
   - `packages/cms/src/public-http/routes/site/pages/handlers/__tests__/slug-routes.test.ts`
   - `packages/cms/src/react/media/__tests__/media-grid-cursor.unit.test.tsx`
   - `packages/cms/src/react/pages/__tests__/page-editor-rules.unit.test.ts`
2. `test(devops): pin backup refusals, replay eligibility, and export fetch`
   - `packages/devops/src/backup/site/__tests__/backup-service.test.ts`
   - `packages/devops/src/deploy/site/static-publish/__tests__/publish-history.unit.test.ts`
   - `packages/devops/src/static-export/site/__tests__/site-exporter.bindings.test.ts`
   - `packages/devops/src/static-export/site/__tests__/site-exporter.test.ts`
3. `test(mcp): pin access redaction and guarded OAuth writes`
   - `packages/mcp/src/external/__tests__/tool-registrations.test.ts`
   - `packages/mcp/src/federation/hosted/__tests__/external-mcp-repo.sql.test.ts`
   - `packages/mcp/src/federation/hosted/__tests__/store.memory.optimistic.test.ts`
4. `test(platform): assert guarded stream bytes and exact stream failures`
   - `packages/platform/src/fs/__tests__/guarded-reader.binary.test.ts`
5. `test(ui): require a single migration batch for multiple providers`
   - `packages/ui/src/features/media-providers/__tests__/react/hooks/useMediaProvidersTab.test.ts`

## Findings and mutation targets

Each mutation was traced statically against the revised test. None was applied or run.

| # | Review test or new covering case | Entry | Status | Mutation and distinguishing assertion |
|---|---|---|---|---|
| 1 | CMS media-import bindings: bound local video above the ordinary ceiling (new; alongside read-cap test) | F2.6 | FIXED | Set `canUploadStagedVideo` in `bindings.deps.ts` to `async () => false`. The handler would hit the forbidden whole-file port instead of returning a receipt and committing a media row and exact bytes through the real guarded reader, staged uploader, and local object store. |
| 2 | CMS media-import registrations: large video writes before next chunk | F6.2 | FIXED | Delete `if (remainder.length) yield remainder` in `tool-registrations.ts`. The crossing chunk contains three distinguishing bytes past 64 KiB, so staging rejects the short source and never produces the required exact length, digest, and bytes. |
| 3 | CMS media-import registrations: oversized image leg | F4.4 | FIXED | Replace the non-video refusal with `return routeDeps.source.readLocal({ ...request, maxBytes }, {})`. The whole-file error cannot match the 16-byte refusal, and the image may not call either upload port or the read port. |
| 4 | CMS import video conversion: failure after upload preserves the original | F5.5 | FIXED | Move conversion before the original row is committed. Either transcoding never reaches the port or its row snapshot lacks the original. The independent note assertion also requires the exact injected error object. |
| 5 | CMS provider credentials: metadata-only canonicalization | F2.6 | FIXED | Drop the `vaultRecord` descriptor on the fresh upsert row in `buildProviderUpsertRow`. The real repo would assign `repo-fallback` instead of `fresh-canonical`, and an AES-GCM envelope sealed for the intended ID cannot open under the fallback identity. |
| 6 | CMS media publish: bound port parity | F4.1 | FIXED | Set the shared contributor's permission to `content.read`, or have its valid precheck return a refusal unconditionally. Agreement between the contributors no longer suffices because the bound permission and precheck result are checked independently. |
| 7 | CMS media publish: sniffed content type | F4.3 | FIXED | Use `record.source.contentType ?? sniffContentType({ bytes })` in the content type store write. The carried `video/webm` disagrees with the expected `video/mp4` readback. |
| 8 | CMS navigation publish: nested retry and change set | F6.3 | FIXED | Pass `items: menu.doc.items` into the forward `updateMenuTree` call. The nested child's stored target remains `old` even if retry, count and version succeed. The persisted change set separately pins the one entity, version 3, and original inverse tree. |
| 9 | CMS render golden: transform before assets | F1.2 | FIXED | Pass `body` instead of `transformed` to `pageShell`. The managed HTML loses the marker immediately before the asset tag even though call order is unchanged. |
| 10 | CMS post render: absent and supplied embeds/assets | F4.3 | FIXED | Hardcode `pageHtmlEmbeds: undefined` in either renderer, `documentAssets: undefined` in bare, or `renderAssets: undefined` in generic. The positive legs require the exact map identity, the resolved bare asset, and the generic asset callback identity. |
| 11 | CMS slug routes: nested phases and fallthrough | F6.2 | FIXED | Remove the injected `checkSiteRelativeTarget` guard in `nestedPageRoute`. The reserved-path leg invokes the redirect spy and returns `handled` instead of `next`. |
| 12 | CMS media grid: Trash policy from current first page | F4.3 | FIXED | Remove the `tab === "trash"` guard. The resolved Images page incorrectly exposes the supplied `90`-day policy. |
| 13 | CMS page editor: styling identity and type | F4.1 | FIXED | Widen the exported interactive member to `styling: unknown`. The narrowed field no longer matches the fixture type in the compile-time assertion. This mutation requires the tests typecheck in the coordinator's run. |
| 14 | DevOps backup: reserved folder (new; alongside private-target test) | F6.2 | FIXED | Remove `requireUnreservedFolder` from `planSiteBackup`. The exact reserved-folder error no longer occurs before repository inspection. The test also rules out snapshot, collection, and plan writes. |
| 15 | DevOps publish history: confirmed and pending replay selection | F6.2 | FIXED | Reduce `isConfirmedOrPending` to its pending-deploy arm. The reachable peer disappears while the pending deploy remains. |
| 16a | DevOps export bindings: consent assets and destination prefix | F2.6 | FIXED | Use global `fetch(input, init)` in the tracked fetch callback. The global sentinel rejects, and the test requires one exact host request and its binary bytes. |
| 16b | DevOps site exporter: destination URL and warning order | F2.6 | FIXED | Same host-to-global fetch mutation, exercised independently through this fixture's captured runner arguments with its own request init and exact byte assertion. |
| 17 | MCP external access review: remote endpoint | F6.2 | FIXED | Return `parsed.href` instead of `parsed.origin`. The valid HTTPS card contains the path/query and no longer equals the expected origin including port. |
| 18 | MCP SQL repo: guarded OAuth configuration | F3.6 | FIXED | Drop `created_at` from `readPointers().select(...)`. The fake no longer supplies an unselected timestamp, and the explicit projection assertion fails before the existing WHERE checks. |
| 19a | MCP memory repo: guarded OAuth edit | F6.2 | FIXED | Reject whenever `expectedCreatedAt` is supplied in `updateIfVersion`. The same edit with matching creation time, version, and pointers must succeed and read back the new label. |
| 19b | MCP memory repo: guarded OAuth writes (both parameterized cases) | F6.2 | FIXED | Reject whenever `expectedConfig` is supplied in `updateOAuthRuntime`. After each mismatch, the same patch with the matching version, timestamp, and pointer must succeed and read back the new envelope. |
| 20 | Platform guarded reader: success | F1.2 | FIXED | Yield `buffer.subarray(0, 0)`. The success case still sees a close and bounded chunks but fails the concatenated-byte comparison. |
| 21a | Platform guarded reader: shrinkage | F5.5 | FIXED | Replace the short-read `FsFilePathError` with a generic error. The exact type and 131072-byte descriptor-length message are required. |
| 21b | Platform guarded reader: abort | F5.5 | FIXED | Throw a new generic error instead of the abort signal's reason. The rejection predicate requires object identity with the sentinel. |
| 22 | UI media providers: one startup migration batch | F4.3 | FIXED | Call `applyProviderChanges` separately for each eligible provider during startup migration. The call ledger must contain one batch with both edits and no operation for marker-only `b`. |

## Static review and deletions

Applied the Author Checklist to the changed cases. Checked mutation sensitivity, positive and refusal reachability, titles, production mechanisms, distinguishable inputs, unconditional checks, persisted or caller-visible outputs, and cleanup. Existing neighboring coverage stays in place. The only new test declarations are the staged binding and reserved-folder cases, with no declarations deleted or skipped. The old fake-only credential assertions were replaced by persisted identity, ciphertext change, and authenticated readback. Broad failure assertions were tightened, and the video conversion callback assertion moved outside the production catch. No production code, coverage config, or unrelated scaffolding was deleted or changed.

No test, mutation, build, install, lint, or typecheck was run. No sheets were rejected, stopped, or left for implementation. Opus owns execution, including the compile-time styling assertion. Tovu needs no new exports, subpaths, or changes.
