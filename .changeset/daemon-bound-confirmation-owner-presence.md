---
"@jini-ai/daemon": patch
---

`createBoundConfirmations` now treats an owner as bound whenever one was given, whatever its value: an owner of `0`, `''` or `false` must match like any other. A `null` owner means "bound to nobody" and the prompt is refused before it is emitted. `BoundConfirmationBinding.owner` and `BoundConfirmationsDeps` document the immutability and unguessable-ID preconditions.
