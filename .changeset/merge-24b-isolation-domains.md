---
"@jini-ai/cookie-consent": patch
"@jini-ai/db": patch
"@jini-ai/admin": patch
"@jini-ai/plugins": patch
"@jini-ai/user-management": patch
---

Subpath isolation: entries import the exact shared leaf they need instead of a sibling domain's barrel (cookie-consent `site/http`, db recovery tool registrations), and isolation metadata classifies pure shared rules and the member-login flow. No runtime behavior change.
