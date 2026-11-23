---
"@jini-ai/admin": minor
---

Host-injected collaborators for three admin seams (breaking for direct callers):

- `useExternalEntryRefresh` (`shell/hooks/use-external-entry-refresh.hooks`) takes the host's `useSettlementGeneration` as a required input field and gains the `_optional` second object; it no longer reads the admin kit's hook itself.
- `shell/components/Select/Select.hooks` no longer exports the single-object `useSelectDropdown` pass-through; hosts inject the UI library's two-object `useSelectDropdown({ value, onChange, options }, { disabled })` into the Select directly.
- `posts/PostAuthorFields` and `posts/PostPublishingFields`'s `PostPublishAtField` take `agentHandle` as a required prop instead of importing Core's implementation; rendered handles, values, callbacks and translations are unchanged.
