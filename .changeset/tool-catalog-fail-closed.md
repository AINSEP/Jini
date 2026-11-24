---
"@jini-ai/daemon": minor
"@jini-ai/server": patch
---

Tool catalog routes fail closed. `ToolCatalogHttpDeps` is now `{ catalogFor }` (per-principal) or `{ catalog, unscoped: true }` (a single-principal host that says so). A host that passes only a catalog gets a 500 instead of the unscoped catalog, and a handler reached without the resolved view answers `UNAUTHORIZED`. The routes mount through `gatedJsonRoute`; the duplicate mount helper is gone. The local daemon preset declares itself unscoped.
