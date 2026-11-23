---
"@jini-ai/core": minor
---

Add `./contracts/site/daemon` (ToolAccessChange, PrepareToolGuidance, FrontendSessionOwner), `./contracts/site/plugins-host` (plugin activation/contribution types), `./contracts/site/db-data-modules` (ColumnType, DataModuleDecl and their parts) and `./contracts/site/assistant-tool-contributions` (DuplicateResourceHandler, DuplicateResourceHandlerContributor). daemon, plugins/host and db/data-modules keep exporting the same names as type re-exports.
