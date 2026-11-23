---
"@jini-ai/integrations": minor
---

Media-provider outbound calls go through an injected `MediaGuardedFetch` instead of importing
`@jini-ai/platform/http/guarded` (owner rule K5, XC-5). `fetchMediaOutbound` and the dispatch carriers require it;
`createMediaDispatchEngine` accepts `guardedFetch` and, until hosts pass it, binds the node composer's
`nodeMediaGuardedFetch` (`@jini-ai/integrations/media-providers/node`).
