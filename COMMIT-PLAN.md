# Media bug handoff (working tree only)

Tests are written before their fixes. No installs, builds, tests, typechecks, or linters are run, per dispatch. RED/GREEN and mutation execution remain for the coordinator.

## Planned order

1. LF-1 host store cap: Tovu-only; pending its half, before the other attachment changes. Set `maxStoredBytes: MAX_UPLOAD_BATCH_BYTES`; mutation `omit-scope-max-stored-bytes`. The older-50-MiB-batch claim in the original sheet is incorrect.
2. IMPLEMENTED — LF-1 Jini reader/native-image predicate: `packages/daemon/src/attachment-content.ts`, `packages/daemon/src/http/attachment-owner-read.ts`, `packages/daemon/src/http/__tests__/attachment-owner-read.test.ts`. Mutation `read-image-before-limit` moves the full-read cap after `readFile`. Added direct bounded-prefix/video-notice and exact-PNG-pixels evidence; mutation `hydrate-byok-video` restores full video hydration. Host CLI/BYOK tests and `hydrate-staged-video` remain pending there.
3. IMPLEMENTED — LF-1 staging: `packages/daemon/src/http/attachment-staging.ts`, `packages/daemon/src/http/__tests__/{attachment-site-staging,attachments}.test.ts`. Mutation `stage-with-plain-copy` drops `COPYFILE_FICLONE`. Existing alias/identity/cleanup assertions retained; staging test strengthened with mode and distinct-inode checks.
4. IMPLEMENTED — LF-2 Jini admission/approval: `packages/cms/src/asset-transfer/{copy-tool,asset-destinations}.ts`, `packages/cms/src/asset-transfer/__tests__/copy-tool.test.ts`. Mutations `copy-keeps-media-at-10mb` restores the old selected read cap; `encode-media-approval-batch` removes the early destination return. Tovu converting-uploader binding and `asset-persist-uses-bare-upload` integration test remain for its half.
5. IMPLEMENTED — LF-3 Phase A Jini JSON routes: `packages/cms/src/admin-http/routes/media/{shared,upload,replace}.ts`, `packages/cms/src/admin-http/routes/media/__tests__/{upload,replace}.test.ts`. Mutation `decode-before-json-size-check` moves strict decoding ahead of the size assertion. Required host cap, no product byte constant in Jini. Q5 is answered: host policy 192 MiB decoded / 257 MiB JSON.

## Deferred

- LF-1 host cap, descriptor reader, BYOK/live-input binding and host tests are Tovu-owned.
- LF-2 converting importer wiring and real conversion integration test are Tovu-owned.
- LF-3 Phase A product constant, parser and browser encoding gate are Tovu-owned.
- LF-3 Phase B remains NEEDS-OPUS, dependent on Phase A and real storage/FFmpeg validation. No streaming work authorized for this programmer phase.

## Completion / review

- Branch `codex/bug-mediaj`; unchanged HEAD `b8a8ee0f98ba1efd2a72b7a39f884c9862ded187`. No commits created; `.git` remains read-only.
- Initial regressions added before production changes; direct video/PNG delivery coverage expanded during review. Tests and mutations have NOT been executed. No existing tests deleted or assertions weakened. Added 2 attachment-reader tests, 2 copy-tool tests, and 4 JSON-route parameterized cases; strengthened existing staging/auth/identity tests.
- Reviewed all changed files with `git diff`; `git diff --check` passed. No installs/builds/tests/typechecks/linters run. No runtime, RSS, disk or FFmpeg claims.
- Scope audit: only the named daemon/CMS files plus this uncommitted handoff changed. No theme, blob adapter, streaming, migration or product-policy implementation added. Reused the existing native-image set, integrity gate, copy operation, MIME validator port, importer and size-error envelope.
- Deletions during final review: removed the temporary duplicate single-source parsing/selection in `prepare`; kept source validation in `readGroup`. No retained code, comments, tests or files deleted.
- Cost: delivery prefixes allocate at most 64 KiB per attachment, on the checked handle; native images still use the bounded full-byte/base64 path. `files_copy` remains a bounded full-buffer operation. JSON size estimation is constant-space before strict decoding. These are code bounds, not measured RSS savings.

## Required host follow-up / public surface

- No new package subpaths. `isNativeMessageImage` is available from the existing `@jini-ai/daemon` root barrel. Owner-read and staging remain on `@jini-ai/daemon/http`; CMS route/copy-tool paths remain unchanged.
- Supply a REQUIRED positional handle `read({ buffer, position, length })` alongside `stat/readFile/close`. For delivery, pass `selectRead({ prefix }, {})` and its REQUIRED paired `maxFullBytes`; preview/promotion `maxBytes` callers retain their existing full-read behavior. Ownership and both identity checks precede the prefix.
- Bind staging `deps.copyFile` in production to `(src, dst) => copyFile(src, dst, constants.COPYFILE_FICLONE)`. The port also receives `COPYFILE_FICLONE` as its third argument, pinned by the Jini regression. All existing Jini test callers now supply the required dependency.
- Supply `FilesCopyToolDeps.mediaVideoMaxBytes` from the existing video policy. `asset-destinations` delegates MIME validation to `media.validateBytes`; the direct importer does the same through `source.validateBytes`. The common validator accepts an injected allowlist and byte cap, so the host must share direct import's video-capable policy here. No hardcoded image-only policy remains in the Jini destination.
- Bind `media.persist` to the existing `persistImportedMedia` plus converting `storage.upload`, conversion ports and note sink. The existing `bindMediaImportTools` already threads `videoImport`; its storage calls `createConvertingUploader` before `persistImportedMedia` uses it. Verify original-before-derived behavior with the host integration test.
- Supply REQUIRED `maxJsonUploadBytes` to both JSON route deps from Tovu `MEDIA_JSON_UPLOAD_MAX_BYTES` (192 MiB decoded). Parser uses 257 MiB JSON allowance; browser refuses oversized files before encoding. Existing document/ordinary sniffed caps remain unchanged. `assertBase64UploadSize` is internal route sharing, with no new package export required.

## Status

LF-1 Jini half implemented; host cap/bindings pending. LF-2 Jini half implemented; converting production binding/integration pending. LF-3 Phase A Jini half implemented; host constant/parser/browser pending. LF-3 Phase B intentionally left NEEDS-OPUS, dependent on Phase A. No anchor mismatch or rejected sheet encountered. Runtime verification is pending the coordinator by explicit dispatch.
