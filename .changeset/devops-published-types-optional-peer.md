---
"@jini-ai/devops": patch
---

The published-types check (`registryDependencies`, `check`) now also reads `optionalDependencies` and `peerDependencies`, so a linked or `file:` scoped package declared there is caught by the release guard like one in `dependencies`.
