# `@jini-ai/cms/media/site-import/*`

Media-import agent-tool declarations extracted from a host CMS: importing an image or video into the
media library from an https URL or from a file under the host's file browser roots. The fetch
pipeline (SSRF-guarded HTTP client, egress policy) and the tool handlers stay in the host.

## Wiring

- `agent-tools` — `buildMediaImportAgentToolCatalog({ fsRootIds, fsFolderReadRecovery, mediaAssetReadToolId }, _optional = {})` returns
  the `media_replace_file` / `media_import_local_file` / `media_import_from_url` catalog. The host injects its file
  browser root ids (`fs_list_files`' `root` vocabulary) and its owner-facing recovery text for a path outside those
  roots, plus its read tool id for one media asset (named in the result description, so no host tool name
  lives here); there is no pre-bound catalog constant. Host code binds it once with its own constants.
