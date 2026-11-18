---
"@jini-ai/search": minor
---

`defineSearchProviderContribution` takes `{ filename, define }`: `define` is the host's `defineProviderContribution` from `@jini-ai/agent-plugins/lifecycle` (its read/import recovery options are bound inside it, replacing the second argument), so search no longer imports agent-plugins. Search keeps the manifest parser, the restricted-content refusal and the manifest-id check. The `contributeProviders` re-export and the `SearchProviderContributionDefinition` type are removed: import `contributeProviders` from `@jini-ai/agent-plugins/lifecycle`. `@jini-ai/agent-plugins` is no longer a peer dependency of search.
