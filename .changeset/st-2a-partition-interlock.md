---
"@jini-ai/desktop-host": minor
---

Add `@jini-ai/desktop-host/electron/partitions`: a profile partition interlock (holder registry, async writer lock with a token-matched target fence, `acquireSiteSession`/`siteSession`/`assertHeld`, `withPartitionWriter`, strict holder and claim readers, contained partition-root resolver). Add `readPresenceStrict` to `electron/updates` beside the tolerant updater reader, which is unchanged. Every input is injected; unknown claims never authorize mutation. No deletion is performed in this release.
