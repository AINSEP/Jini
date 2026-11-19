# Open bugs

- **Desktop L1: child exit observer argument mismatch.** `packages/sidecar/src/supervision/child-entries.ts` passed a bare callback to a host handle expecting `{ listener }`, losing crash observation and later calling an absent listener. Repaired in the round-2 working tree with object-shaped fixtures and synchronous replay; remains pending cloud red/green and consumer proof.
