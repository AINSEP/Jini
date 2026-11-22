---
"@jini-ai/core": patch
---

New subpath `@jini-ai/core/extension-capability-vocabulary`: `SharedExtensionCapability` and the frozen `SHARED_EXTENSION_CAPABILITIES` (`content.read`, `content.extend`, `hooks.attach`), the vocabulary a host's plugin runtime and site glue both build from. Moved verbatim from the host (C-contracts-core-1's held file); it sits beside `host-read-vocabulary` rather than under `contracts/` because the frozen array is a runtime value.
