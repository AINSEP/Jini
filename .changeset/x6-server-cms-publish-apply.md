---
"@jini-ai/cms": minor
---

Add `@jini-ai/cms/publish/content/apply-failure`, `apply-row` and `backstop-service`: the per-row apply downgrade rules and the apply-time re-verification (existence and edited-again conflict checks, retire sequence binding), plus a hand-send ("backstop") service factory. `withRefusedItem` takes the plugin-hook refusal check and rebuilder (`isPluginHookFailure`, `attachRefusedItem`) from the host, and `createBackstopService` takes the raw-value scan, gap labels, size caps with their refusal copy, and the secret redactor.
