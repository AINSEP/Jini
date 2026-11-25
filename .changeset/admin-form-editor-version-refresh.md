---
"@jini-ai/admin": minor
---

Forms editor version-aware refresh. `AdminFormDefinition` gains optional `version` and `AdminFormUpdatePatch` gains optional `expectedVersion`. The memory adapter now compare-and-sets: new rows start at version 1, legacy rows gain version 1 on their first actual write, a stale basis is refused with 409 `VERSION_CONFLICT`, and a versioned status change or a versioned empty patch is refused with 400 `VALIDATION_ERROR`. The basis is never stored. `useFormEditor` accepts an optional `events` port (the wired hook forwards the injected forms events) and returns a `reload` slice. A clean editor follows outside edits. A dirty one keeps its draft and offers "Reload form", which asks for confirmation first. Save sends the applied version, and a refused stale Save keeps the draft. `FormEditor`'s `useFormEditorHook` prop is now required, and the module mount binds the wired hook. Three new editor strings are added to every forms locale.
