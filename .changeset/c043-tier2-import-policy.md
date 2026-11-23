---
"@jini-ai/plugins": patch
---

`@jini-ai/plugins/host/worker` adds the Tier-2 import policy (C043): `registerTier2ImportPolicy`, `tier2ImportPolicyData`, and the types `Tier2ImportPolicy`, `Tier2TrustedImports`, `Tier2ImportPolicyData`, `Tier2ImportPolicyRequired`, `RegisterTier2ImportPolicyOptional`. A plugin's own modules may import by name only the host's SDK specifiers plus exact specifiers the host trusts for that exact entry; path imports must stay inside the plugin's package, which is the host-registered package root (the entry must be inside it) — not a guess from the entry's location.

`startTier2Worker` takes the policy as an additive optional input (`StartTier2WorkerOptional.importPolicy`, plus the `registerImportPolicy` test seam); existing callers that pass none keep the previous behaviour. `Tier2PluginRef` gains optional `packageRoot`, which `createTier2ImportSeam` fills from the loader's registration (mapped onto a site snapshot); a worker given a policy but no `packageRoot` refuses the import at the import stage.
