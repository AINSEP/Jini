---
"@jini-ai/cms": major
---

`@jini-ai/cms/seo/content-analyzer-plugin/plugin` no longer default-exports a plugin bound to a phantom `@jini-ai/plugin-sdk` module. It exports `createContentAnalyzerPlugin({ definePlugin, beforeSaveHook })` (the word-count pattern) and `readAnalyzerDraft`; the host's own tier-2 worker entry imports its SDK, calls the factory and default-exports the result. Add `@jini-ai/cms/fs-files/agent-tools` (universal): the files tool IDs, `FS_FILES_READ_PERMISSION`, `FS_WRITE_LIMITS` and `getFsFilesAgentToolCatalog({ rootIds, rootDescriptors, maxFileBytes })` with host-supplied roots. Split the widget payload envelope into the pure `widgets/payload-fields` module (still re-exported by `@jini-ai/cms/widgets`). `./public-http/http/site/render/page-body` is classified `node` (it reaches parse5 through embed substitution).
