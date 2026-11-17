---
"@jini-ai/devops": minor
---

`@jini-ai/devops/packaging/electron` exports the release-gate pieces a packaging host reimplemented: `fingerprintTree`, `fingerprintsDiffer` and `sampleMovingRoots` (timed "is the tree still being written to" sampling over injected fingerprint and pause), `withIsolatedPackagedTree` with `assertPackagedTreeIsolation` and `PackagedTreeIsolationError` (run a gate against a copy of the app with no `node_modules` ancestor), and `walkPayloadFiles` (payload file walk with a host-supplied directory pruning predicate).
