---
"@jini-ai/diagnostics": minor
---

`@jini-ai/diagnostics/web-evidence` gains the path guard a host uses before fetching a route of its own site: `resolveSameOriginPath({ raw, base, checkPathname })` (raw-shape rules, one percent-decode pass, structural same-origin check, then the host's own pathname policy as an injected verdict function), `SameOriginPathError`, `MAX_PATH_LENGTH`, and the helpers `assertRawPathShape`, `assertNoTraversalSegment` and `resolveWithinOrigin`. It also gains `readBoundedBody({ response, maxBytes })` (reads at most `maxBytes`, then cancels the stream) and `toCookieShapes({ headers })` (the `Set-Cookie` name and attributes, never the value). Additive; no existing export changes.
