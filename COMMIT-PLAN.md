# BUGD media — working-tree handoff

No commits, version bumps, installs, builds, tests, typechecks or linters are authorized here.

## Completed implementation units (coordinator commit order)

1. Phase A: refuse oversized Admin files before encoding.
   - Regression first: Jini hook-level equivalent of the host regression (the host production binding remains for its follow-up).
   - Mutation `read-before-client-limit`: move the size guard below `readFileAsBase64`; the zero-reader assertion must fail.
   - Files: `packages/admin/src/screens/media/__tests__/use-media.hooks.unit.test.tsx`, `packages/admin/src/screens/media/hooks/use-media.hooks.ts`, `.changeset/media-json-browser-limit.md`.
2. Phase B: guarded stream, private staging, selected-provider publication, staged conversion.
   - Mutation `local-video-collects-chunks`: collect before writing; the source's acknowledgement assertion must fail.
   - Mutation `stream-ignores-descriptor-length`: enforce only the absolute cap; growth below that cap must be rejected.
   - Mutation `hydrate-staged-ffmpeg-output`: load output in one read; whole-file and 64 KiB assertions must fail.
   - Mutation `use-retrying-byte-put-for-stream`: send through `client.fetch`; the forbidden-byte-send assertion must fail.
   - Host regression `conversion-reloads-original-buffer` remains for the host half; prohibit `blobStore.get` during composed import.
   - Files:
     - `packages/core/src/object-store.ts`
     - `packages/core/src/contracts/site/cms-media.ts`
     - `packages/core/src/contracts/site/media-tool-ports.ts`
     - `packages/platform/src/fs/guarded-reader.ts`
     - `packages/platform/src/fs/staged-file.ts` (new)
     - `packages/platform/src/fs/index.ts`
     - `packages/platform/src/fs/__tests__/guarded-reader.binary.test.ts`
     - `packages/platform/src/object-store/local-fs.ts`
     - `packages/cms/src/media/ports.ts`
     - `packages/cms/src/media/blob-store.object-store.ts`
     - `packages/cms/src/media/media-service.ts`
     - `packages/cms/src/media/video-transcode.ts`
     - `packages/cms/src/media/index.ts`
     - `packages/cms/src/media/site/import-video-conversion.ts`
     - `packages/cms/src/media/site-import/tool-registrations.ts`
     - `packages/cms/src/media/site-import/bindings.ts`
     - `packages/cms/src/media/site-import/bindings.deps.ts`
     - `packages/cms/src/media/site-import/agent-tools.ts`
     - `packages/cms/src/media/site-import/__tests__/tool-registrations.test.ts`
     - `packages/cms/src/media/site-import/__tests__/bindings.test.ts` (required-port fixture updates only)
     - `packages/agent-plugins/src/ffmpeg-transcode/adapter.ts`
     - `packages/agent-plugins/src/ffmpeg-transcode/__tests__/adapter.test.ts`
     - `packages/agent-plugins/s3-compatible/object-stores/s3-compatible.mjs`
     - `packages/agent-plugins/s3-compatible/__tests__/object-store.test.mjs`
     - `.changeset/staged-local-video-import.md` (new)

Both units are implemented, not runtime-verified. No implementation step stopped for an anchor mismatch.

## Boundaries

Jini only. Existing subpaths remain. Platform FS barrel exports the actual staged-file adapter. No provider capability means the existing byte path, before staging. Host owns upload policy, filesystem/owned-root bindings, the traced single-send transport and packaged-app acceptance/RSS measurements.

## Verification

All runtime verification and mutation execution deferred to the coordinator as requested. Static diff review only. No tests removed or weakened. Five named regression declarations plus the three descriptor companion cases were added; no pass/fail or coverage figures are claimed.

Review correction: `validateBytes` receives `bytesTruncated: false` for the intentional sniff prefix. That flag means the bounded reader refused a clipped body; the checked descriptor/stream separately enforces the actual original length and ceiling. Setting it true would make the existing validator refuse every large video.

Review deletions: removed the interim `localImportInput`, `persistLocalBytes`, and `persistLocalStaged` helpers, consolidating local metadata/persistence into `persistLocalImport`. Removed an unused staged target destructure and reverted a shared failure-reason-set expansion so ordinary conversion keeps its original classifications. No pre-existing behavior or tests were deleted.

## Host follow-up and acceptance still open

- Phase A: pass `maxJsonUploadBytes` to the production Admin binding and direct fixtures. The exact production `useWiredMedia`/API regression belongs to the host; the new Jini case exercises `bindMedia` and the unchanged real browser encoder with injected hook ports.
- Bind `withLocalStream` to `withGuardedBinaryStream` with descriptor mode and the same deny/root policy, forwarding the per-file `maxBytes` and signal.
- Bind `withStagedFile` from `createStagedFileAdapter` (`@jini-ai/platform/fs`) to the existing owned site temp scope and injected filesystem; register the media-video temp prefix with the existing sweeper.
- Inject `sealStagedFile` into `createFfmpegMediaTranscoder`; expose its `transcodeStaged` as `VideoImportOptions.ports.stagedTranscoder`.
- Inject `createConvertingStagedUploader` through the existing host wrapper that supplies the link/copy-description binding, preserving those host effects for derived records.
- Inject the traced, single-send `ObjectStoreHost.sendStaged` transport and a signer exposing `sign`. S3 capability stays unavailable (legacy byte fallback) without both. Real signed streaming PUT verification is OPEN: this Jini-only task cannot supply or exercise the host's production transport.
- No new manifest subpaths are needed. Existing exports now also expose `uploadStagedVideo`, `convertStagedMediaVideo`, the staged contracts, `createConvertingStagedUploader`, and the actual staged-file adapter via the FS barrel.
- Add the specified composed host regression: original blob/row/rendition before FFmpeg; no `blobStore.get`; cleanup and original survival on conversion failure/cancel; duplicate-import dedup. Mutation `conversion-reloads-original-buffer` remains unexecuted.
- Opus: all named mutations, packaged 500 MiB local/S3 imports, hashes/playback/cancellation, separate Node RSS/FFmpeg RSS/spool disk measurements. A 64 KiB chunk limit is not an RSS measurement.

## Static architecture review

Shared owners retained: existing descriptor validation, selected object-store/key derivation, SHA-256 claim lock/dedup/resurrection/journal, original rendition commit, derived link rollback and sanitized conversion note. Storage streaming ports contain no Node objects or spool paths; only the admitted staged transcoder descriptor carries private paths. No product/theme/schema/manifest/version changes. Existing oversized `media-service.ts` and `guarded-reader.ts` remain in place; splitting them would exceed the named file map.

Self-validation: not run, explicitly prohibited by dispatch. Runtime correctness, deployed S3 behavior and resource measurements require the coordinator/host test phase.
