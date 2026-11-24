---
"@jini-ai/server": minor
---

`countLegacyOwnerStore` and `readLegacyOwnerStore` (`@jini-ai/server/owner-store`) now take the host's
`ports: LegacyOwnerStorePorts` (SQLite kernel opener, owner-store reads, vault repo and legacy-owner decoder)
instead of importing `@jini-ai/db` and `@jini-ai/platform` (owner rule K5, XC-6b). Behaviour is unchanged:
read-only, never migrates, never creates a key.
