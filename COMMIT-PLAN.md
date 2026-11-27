# COMMIT-PLAN — r62-ttq-j1 test review

Base `a9f58d6bcf69d817876d165992ef29aa8d2c8c6a` (`codex/w62-ttqf-j1`, matching the local `origin/codex/m27j` ref). Coordinator commits the working tree in the order below. Leave this plan uncommitted.

## 1. Pin staged S3 and FFmpeg streaming contracts

- `packages/agent-plugins/s3-compatible/__tests__/object-store.test.mjs` — staged PUT:
  - **F3.6.** In `object-stores/s3-compatible.mjs`, change only the `sendStaged` method to POST, its destination to a different URL, or omit either staged header. Each mutation fails at the real writer's outbound request assertions, independently of the signer assertions.
  - **F4.3.** Buffer the complete staged iterable on the first pull, then yield it in one chunk. The source has three chunks of 65,536, 65,536, and 1 bytes. The bounded/exact chunk checks catch the oversized yield, and the pulls-to-yields check also rejects buffering that re-slices to the original sizes.
  - **F6.2.** Delete the `signal?.throwIfAborted()` immediately after `client.sign`. The new post-sign case rejects only with the signer's abort sentinel and expects one signing, zero sends, and zero opens. The original success, HTTP 503, and mid-send abort cases remain.
- `packages/agent-plugins/src/ffmpeg-transcode/__tests__/adapter.test.ts` — staged conversion:
  - **F1.2.** In `ffmpeg-transcode/adapter.ts`, return `failure("invalid")` for every staged refusal. Oversize and abort then fail the exact reason/message check. The non-MP4 case independently pins `invalid` and its message.
  - **F2.2.** In `platform/src/fs/staged-file.ts`, change only the published output iterator to read through `file.readFile()` and yield the whole file. The consumer rejects a chunk over 64 KiB. Even if the mutation splits the buffer into valid chunks, the live handle spies reject the whole-file read.

## 2. Pin CMS authorization and transaction boundaries

- `packages/cms/src/admin-http/routes/__tests__/y5-plugin-install.test.ts` — **F2.4.** In `routes/plugins/install.ts`, pass a different parser to `facts.parseZip` only for ZIP apply. Both denied runs still require zero parser calls. Both authorized runs must reach the oversized reply (413) and call the exact factory-produced object once.
- `packages/cms/src/admin-http/routes/media/__tests__/batch-providers.test.ts` — **F6.2.** In `routes/media/batch-providers.ts`, move the awaited authorization until after `applyProviderChanges` starts. A valid mixed batch with the permission denied must reject, make no service call, and leave the independently read vault snapshot unchanged. The service spy wraps the real implementation.
- `packages/cms/src/admin-http/routes/media/__tests__/providers.test.ts` — **F4.4.** In `media/site/provider-credential-store.ts`, replace the revision mismatch condition with `expectedRevision !== undefined`. Both stale ETag cases may still reject, but both fresh ETag writes now have to succeed with HTTP 200 and read back the new model.
- `packages/cms/src/core/commands/__tests__/revert.unit.test.ts` — **F6.2.** In `core/commands/revert.ts`, move `finalizeRevert(required)` outside the transaction. The outbox fault must see both inverses and a reverted row inside the transaction, reject with its own sentinel, and leave both values and the row restored. The later-inverse failure case remains unchanged.

## 3. Pin admin wire payload and list ordering

- `packages/admin/src/screens/media/__tests__/media-providers-port.unit.test.ts` — **F2.6.** In `screens/media/api/media-api.ts`, serialize `{ patches }` rather than `{ removes, patches }`. The real port plus client must send the exact PATCH path and body and return a distinct server reply.
- `packages/admin/src/posts/__tests__/y5-post-list.test.tsx` — **F2.1.** In `shell/lib/admin-post-list-sort.ts`, independently replace the Slug and Status comparators with `return 0`. Each sort works from the original `One, Alpha` input, so each mutation fails its own rendered `Alpha, One` link-order assertion.

## 4. Pin page editor wiring

- `packages/admin/src/pages/__tests__/y5-page-editor.test.tsx` — four separate checks:
  - **F6.1, draft preview.** In `PageEditorPreview.tsx`, remove the draft iframe's `name`, or keep the POST form's `action` at the first URL. The DOM assertions pin the named target pair and the revision-specific action before and after refresh, alongside the existing body and GET checks.
  - **F4.3, HTML pane.** In `PageEditorChrome.tsx`, still call the converter but pass the raw select value to the setter. Selecting the host's default after `page.html` must produce `templateChoice: null`, not the DOM sentinel.
  - **F2.1, editor rules.** In `hooks/page-editor-preview.hooks.ts`, call `buildPageAutosaveDraft` but drop `scheduleAutosave`. The per-fixture scheduler must receive the complete edited draft before save.
  - **F4.3, change notices.** In `PageEditorNotices.tsx`, still call either formatter but render its default copy. Each banner must render its own host sentinel text while keeping the exact argument assertions.

## 5. Pin media hints, plugin callbacks, and dock dependency results

- `packages/admin/src/screens/media/hooks/__tests__/use-edit-media-panel.injection.test.tsx` — **F3.6.** In `use-edit-media-panel.hooks.ts`, keep parsing the draft but freeze the exposed hint at its initial value. The exact public hint must go from null to the host attribute's message to null after clearing.
- `packages/admin/src/screens/plugins/__tests__/plugins-kit.unit.test.tsx`:
  - **F1.3, tab icons.** In `Plugins.tsx`, swap the Installed and Downloaded icon components. The exact host marker must remain inside its own tab ID wrapper.
  - **F7.6, row kit.** In `PluginLists.tsx`, make the Downloaded Enable onClick a no-op. Each panel owns a fresh toggle spy and must independently invoke it exactly once with the plugin.
- `packages/admin/src/screens/plugins/__tests__/agent-plugins-kit.unit.test.tsx` — **F2.5.** In `AgentPluginsOverlays.tsx`, call `setPendingDisable(pendingDisable)` or toggle a different plugin. The exact ordered `[clear, null]`, `[toggle, example]` events reject either mutation.
- `packages/admin/src/shell/components/AssistantDock/__tests__/y5-dock.test.tsx` — **F4.3.** In `AssistantDock.state.hooks.ts`, still call either injected rule but substitute the BYOK default for its result. The public runtime visibility and the discovery hook's explicit `skillsAvailable: false` each differ from those defaults.

## Author checklist and diff audit

- Reviewed every changed case against the catalog's Author Checklist. The bullets above record each concrete mutation and the discriminating assertion. Mutations were not applied or run in this dispatch.
- Relevant error, second-call, and in-flight cases are covered where the review calls for them. S3 and FFmpeg retain success and refusal paths. ZIP exercises denial then authorization per mount. Batch retains its failed-write/retry test and adds denial. Conditional PUT proves a real successful retry, and revert isolates the later outbox fault. No extra timeout or retry cases were introduced.
- Assertions exercise the real writers, resolver/handlers, components, hooks, and port/client within scope. Fixture doubles sit at injected boundaries and record exact arguments or provide fault/host values that differ from defaults. Read-back checks use vault, route, repository, rendered DOM, or returned controller state. The cases use independent fixtures, pinned existing clocks where needed, and restore the observed FFmpeg handles.
- No cases, production code, or coverage configuration deleted. Replaced the short S3 fixture, success-only FFmpeg result check, loose banner/message and callback checks, and default-matching host values with the stronger checks listed above. Removed the now-unused real picker converter import. No out-of-scope additions were retained.
- Static count across the 13 touched files is **96 → 99** registered tests, with constant `.each` rows expanded. New registered cases are denied batch, outbox failure, and real batch forwarding. Post-sign abort is a new outcome within the existing S3 test.
- Static diff check only. No tests, suites, mutation runs, builds, installs, linters, or typechecks. No production bugs required a source edit. No Tovu package subpaths or exports changed, and no Tovu follow-up is needed for these fixes.
