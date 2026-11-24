---
"@jini-ai/plugins": patch
---

Move the plugin tool-access lowering step (`./runtime/lower-tool-access`, the host injects its error class) and the consumer-owned post-read / provider-faces ports (`./runtime/service-ports`) from the host.
