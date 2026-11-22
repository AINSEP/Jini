---
"@jini-ai/agent-plugins": minor
---

Retire the `./commerce/server` entry (`core/commerce-server.{mjs,d.ts}`), which only re-exported `@jini-ai/commerce`, and drop the optional `@jini-ai/commerce` peer. Hosts import the commerce kernel from `@jini-ai/commerce` directly. The dormant `./commerce` payload exports are unchanged.
