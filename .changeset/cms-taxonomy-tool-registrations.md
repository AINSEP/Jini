---
"@jini-ai/cms": minor
---

`@jini-ai/cms/taxonomy` now exports `buildTaxonomyToolRegistrations`, `taxonomyDerivedRisk` and the port types `TaxonomyPackageToolDeps`, `TaxonomyMergeGateway`, `TaxonomyMergePrepared` and `TaxonomyToolSurfaces`: the taxonomy agent-tool handlers. The host passes its catalog, its gated-mutation gateway, its human-confirm handler (the merge dialog and its wording stay the host's), its strict-keys guard, its slug function and its content-type policy.
