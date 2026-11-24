---
"@jini-ai/agent-plugins": patch
---

Add `./site/supersession` (trusted-replacement supersession declared by the replacing plugin; the host injects its manifest readers) and `./site/admin-surfaces/delivery-bindings` (the admin-surface `deliveryBindings` port over a host's form-delivery binding store; the host injects `deriveConnectionRef` alongside its existing deps).
