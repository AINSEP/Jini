---
"@jini-ai/core": patch
"@jini-ai/daemon": patch
---

A host can name groups of tools to the delegated-tool route. `DelegatedToolsHttpDeps.toolFamilies` (a `ToolFamilyPort`) is asked only about an id the route's registry does not hold; when it knows the id as a group, the `404 UNKNOWN_TOOL` says `"x" is a group of tools, not one tool. Call one of: ...` and carries `details.family` (members and selector), filtered by the route's own registry so a group answer never shows a tool the run cannot see. Nothing is executed or rerouted by the route. `@jini-ai/core/tool-call-text` adds `toolFamilySentence`; `@jini-ai/daemon/http` exports the `ToolFamilyPort`, `ToolFamilyDescription` and `FamilySelector` types.
