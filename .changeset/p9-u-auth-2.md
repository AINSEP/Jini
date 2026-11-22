---
"@jini-ai/user-management": minor
---

Users: `bootSessionRoute` and `localBootSessionRoute` join `@jini-ai/user-management/admin-http/auth`. Redemption goes through the host's request-aware `AuthRequest.redeemBootSession`; a deliberate redemption failure is thrown as `OwnerAuthFailure` (for the host's redacted envelope) while repository faults pass through to its error chain.
