---
"@jini-ai/admin": minor
---

BREAKING: `@jini-ai/admin/core/module` no longer exports the descriptor types, `adminPort`, `defineAdminModule`, `AdminPortToken`, `PortMap` or `PortValues`; import them from `@jini-ai/core/contracts/admin-module`. `AdminPortToken` is now core's `Token`.
