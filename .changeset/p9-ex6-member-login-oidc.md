---
"@jini-ai/user-management": patch
---

Move the host-neutral member OIDC login facade from the host (`./member-login/oidc-login`); OAuth operations, the AAD formatter and the client identity are injected through `OidcLoginDeps`.
