---
"@jini-ai/oauth": minor
---

Re-export the moved flow signature types from `@jini-ai/core/contracts/oauth`, and export `oauthFlowOperations` (`satisfies OAuthFlowOperations`).

Public OAuth failures retain only allowlisted protocol codes. Unknown provider errors use plain refusal text and `invalid_provider_error` metadata, without echoing provider text or retaining its cause. Registration, device authorization and callbacks share one internal protocol-code allowlist.
