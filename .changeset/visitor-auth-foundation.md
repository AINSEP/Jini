---
"@jini-ai/capability-providers": minor
---

Add the universal `@jini-ai/capability-providers/visitor-auth` subpath for public-site
visitor/social login. It exposes provider-neutral Google, Facebook, and LinkedIn configuration
metadata, an extensible definition registry, typed host ports, and pure OAuth/OIDC state, nonce,
and PKCE lifecycle decisions.

The subpath deliberately ships no provider SDK or working provider adapter. Client secrets remain
opaque host-owned references, transaction persistence must be tenant-scoped and one-time, and
identity/session creation stays in the consuming application's authorization boundary.
