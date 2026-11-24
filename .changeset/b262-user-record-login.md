---
"@jini-ai/user-management": minor
---

`UserRepoPort` gains a required `recordLogin({ workspaceId, principalId, lastLoginAt })` that sets only the login time. Password and passkey login use it instead of a whole-row `save`, so a password reset, rename or email change that commits between login's read and its timestamp write is no longer reverted. Host adapters must implement it as a single-column update.
