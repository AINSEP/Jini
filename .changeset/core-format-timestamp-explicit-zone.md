---
"@jini-ai/core": minor
"@jini-ai/admin": patch
"@jini-ai/ui": patch
---

`formatTimestamp` no longer reads the host's ambient timezone: `{ timeZone: "local" }` is replaced by `{ viewerTimeZone }`, an IANA zone the host resolves at its own boundary (for a browser, `Intl.DateTimeFormat().resolvedOptions().timeZone`). Equal arguments now render equally on every host. Zone-less ISO date-times stay as wall time; non-ISO text is shown unchanged instead of being parsed in the host zone. The comments queue and the standing-draft recovery banner pass the browser's zone.
