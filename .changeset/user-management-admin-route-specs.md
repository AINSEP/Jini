---
"@jini-ai/user-management": patch
---

The admin users routes ship as server-neutral `defineJsonRoute` specs (`@jini-ai/user-management/admin-http/routes/users/{list,create,update,disable,enable,reset-password,delete,assign-role,attach-policy,create-role,update-role,delete-role,create-policy,update-policy,delete-policy,write-policy-permission}`) with their DTO helper at `@jini-ai/user-management/admin-http/http/users`, plus `@jini-ai/user-management/admin-http/owner/mfa-deps` (`composeOwnerMfaDeps`). Each spec reads only its own small deps type; the host injects the identity services from `./server`, the identity deps assembler, Trash and account-protection collaborators and host error predicates. Wire bodies and statuses are unchanged.
