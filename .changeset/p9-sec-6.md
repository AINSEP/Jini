---
"@jini-ai/admin": patch
---

security (SEC-6): human-only root-key reveal and copy. Optional `RootKeyPort.reveal`, opt-in `createHttpRootKey(..., { reveal: true })` (`POST <path>/reveal`), memory `revealHex`. The revealed value lives in a private controller cell (never the snapshot); hide, reload, a write and dispose drop a late reply. Reveal, Copy and Hide carry no agent handle and sit in `data-agent-private` wrappers. New `clipboard?` module option. Also rv1123c FIX 1 (refusals keep only the code; `describeRefusal?` supplies host copy) and FIX 3 (page and root-key tab hooks are required inputs bound in `react/bindings.ts`).
