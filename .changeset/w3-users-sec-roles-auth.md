---
"@jini-ai/admin": minor
"@jini-ai/user-management": minor
"@jini-ai/core": patch
---

w3-users-sec: duplicate admin auth/roles DTO leaves removed (core owns AdminUser/AdminRole/AdminPolicy/AdminPolicyPermission); `resolveRolesTabs({ t }, _optional)` no longer owns navigation; roles dictionary + rules move to `@jini-ai/admin/roles` with a host-bound `RolesApiErrorPort`; `./identity/boot-session-token` is a node entry; RecoveryCodesCard hooks are required inputs; owner-auth K1 routes take narrowed per-route contexts.
