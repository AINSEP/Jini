---
"@jini-ai/user-management": patch
---

`createRole` and `updateRole` refuse a name another role in the workspace already holds with `IdentityConflictError` (`code: "RESOURCE_CONFLICT"`, message `A role named "X" already exists. Pick another name.`), checked inside the identity transaction with the save. Previously SQL hosts hit their unique index as an untyped 500 and in-memory hosts silently kept two roles with the same name. New export: `assertRoleNameAvailable`.
