---
"@jini-ai/daemon": minor
"@jini-ai/server": minor
"@jini-ai/agent-runtime": minor
"@jini-ai/provider-plugins": minor
---

xAI OAuth and search move out of the engine into `@jini-ai/provider-plugins/xai` (owner sign-off on this API-surface change pending).
Removed: daemon `xaiRoutes` and the other xAI route/type exports from `@jini-ai/daemon/http`, the `@jini-ai/daemon/ports/xai-oauth` subpath, the `xai` option and feature of `@jini-ai/server`'s built-in features (and the local daemon's xAI listener slot), and the xAI preset (`XAI_OAUTH_*`, `xaiOAuthRedirectUri`) from `@jini-ai/agent-runtime`.
Added: `@jini-ai/provider-plugins/xai` (plugin manifest), `/xai/routes`, `/xai/preset`, `/xai/oauth-port`. A host mounts `xaiRoutes` through its own HTTP extension and injects the OAuth port, base-URL guard and clock.
