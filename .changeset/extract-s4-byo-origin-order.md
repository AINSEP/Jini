---
"@jini-ai/integrations": minor
---

Restore the bring-your-own OAuth client's previous error behaviour in `resolveByoClient` (`@jini-ai/integrations/api-connections`). `ApiConnectionByoCredential.allowedOrigins` is now a deferred function (`() => readonly string[]`) that `resolveByoClient` calls only after the credential read has resolved, outside the read's "unreadable" catch. A failure while projecting a saved credential's origins (for example a malformed saved base URL) once again rejects with the host's raw error instead of being reported as an unreadable credential; read failures, wrong-origin and missing-client-id refusals are unchanged. Hosts implementing `ApiConnectionByoCredentials.read` return `allowedOrigins: () => origins` instead of the array.
