---
"@jini-ai/agent-plugins": minor
---

One lock ordering for layout migration, the publisher-ID move, seed and restore. New
`withWorkspaceMigrationLock` (persistent-state) holds a workspace's layout-migration lock and hands
explicit, workspace-scoped `ownership` to `migratePluginLayout(required, { ownership })`, which then runs
under the held lock without reacquiring it (direct calls still take it). `seedBundledAgentPlugins`
accepts `ownership` (forwarded to the default migration and to `migrateBeforeSeed`'s optional argument)
and `heldPluginIds` (reported failed, never installed). New `seedWithBundledIdUpgrade` runs move, seed
and put-back inside one held lock. `restoreUnseededUpgrades` now reports `held` when a put-back rename
fails, keeping the saved copy, instead of claiming `restored`.
