---
"@jini-ai/cms": patch
"@jini-ai/admin": patch
"@jini-ai/ui": patch
---

Save explicit media-provider clears and edits in one atomic collection PATCH and
vault batch. Hosts must mount the batch provider route with workspace-bound store
dependencies and supply the required `applyProviderChanges` rows-port method.
