---
"@jini-ai/user-management": minor
---

Users: `currentUserRoute` (`GET /api/admin/v1/auth/me`) and `createPasswordStatusRoute()` (`GET /api/admin/v1/auth/me/password-status`, with a per-registration hash memo and an injected default owner password) join `@jini-ai/user-management/admin-http/auth`.
