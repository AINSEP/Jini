---
"@jini-ai/user-management": patch
---

Add the role/policy read route specs (`list-roles`, `list-policies`, `list-policy-permissions`, authorized for `role.manage` with no entity type) and `remove-policy-permission` (bare 204 via `routeReply`, host owner guards injected).
