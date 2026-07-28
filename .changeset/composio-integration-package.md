---
"@jini-ai/composio": minor
---

Add an incubating, headless Composio integration package with static and live
catalog discovery, injected configuration and credential stores,
connected-account OAuth lifecycle support, guarded tool execution, and a
Composio-prefixed application service. Catalog and execution boundaries fail
closed: aggregate hydration is unsupported, execution requires current
per-connector schemas plus matching credential evidence, provider-discovered
tools remain display-only unless exactly curated, execute input is bounded
before I/O, secret files reject symlinks, and ownership-checked locks cover
all persisted mutations.
