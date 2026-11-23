---
"@jini-ai/core": patch
---

Add two host-neutral contracts. `./contracts/site/core-runtime-mode` (`RuntimeMode`) names the host's `production`/`local` runtime-mode policy signal. `./contracts/site/cookie-consent-react` (`ConsentSettingsView`, `ConsentAppearanceView`, `ConsentFieldProblem`) is an additive copy of the React-free view declarations in `@jini-ai/cookie-consent/react`; that module keeps its identical declarations, its components and its exports until the paired cutover.
