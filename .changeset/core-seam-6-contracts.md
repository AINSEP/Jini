---
"@jini-ai/core": minor
"@jini-ai/cookie-consent": minor
---

K4-seam-6: `@jini-ai/core/contracts/site/{user-management-react,cookie-consent,cms-forms}` hold the cross-package port and DTO types; user-management, cookie-consent and cms/forms re-export them unchanged. cookie-consent now depends on `@jini-ai/core` (types only).
