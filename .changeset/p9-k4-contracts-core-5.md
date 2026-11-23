---
"@jini-ai/core": patch
---

Add nine host-neutral site tool-metadata declaration maps under `./tool-metadata/<name>` (the single owner, shared with the Inject-side flat maps; the interim `./tool-metadata/site/*` subpaths were folded into it before release) (`files-copy`, `forms`, `identity`, `mail-status`, `media`, `media-import`, `navigation`, `observability`, `pages`). Each exports a `toolMetadata` map typed with `ToolMetadataById<ToolApprovalPolicy>`; tool ids, search vocabulary and approval declarations are moved verbatim from the host, and none names a host rule, so they fit any host's narrowed rule union.
