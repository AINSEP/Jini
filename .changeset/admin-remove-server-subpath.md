---
"@jini-ai/admin": minor
---

Removed the `./server` export subpath. It held only the Composio integration, which moves back
out — now `@jini-ai/integrations/composio`, a subpath of `@jini-ai/integrations`
(`packages/integrations/`; see that package's own changeset for the full history). `jini.entries`
drops its `"./server": "node"` entry, and the `@jini-ai/protocol` devDependency (which existed only
for composio's type-only `JsonValue` references) is removed. No other consumer imported
`@jini-ai/admin/server` — nothing else needs an import-path change.
