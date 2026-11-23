# `@jini-ai/cms/media/site-generation/*`

Media-generation agent tooling extracted from a host CMS. Each module is its own subpath; there is
no barrel.

## Wiring

- `agent-tools` — `buildMediaGenerationAgentToolCatalog({ imageModelIds, mediaAssetReadToolId }, _optional = {})` returns the
  `media_generate_asset` catalog. The host injects `imageModelIds` (it passes the media-providers
  catalogue's `IMAGE_MODEL_IDS`, or the ids of the vendors its registry actually loaded);
  `mediaAssetReadToolId` is the host read tool id for one media asset, named in the result description; this package
  does not depend on the catalogue, so there is no pre-bound catalog constant. Host code that needs
  the built-in projection binds it once: `buildMediaGenerationAgentToolCatalog({ imageModelIds: IMAGE_MODEL_IDS })`.
