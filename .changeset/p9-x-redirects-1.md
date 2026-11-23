---
"@jini-ai/cms": patch
---

Move the redirects routing-phase registration from the host to `./redirects/site/phase-handler`; the host's bound `registerResolvePhase` is now injected through the existing deps object.
