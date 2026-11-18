---
"@jini-ai/agent-plugins": patch
---

The `github` plugin's account-name probe (`readAccountLabel`) sends its bearer-token request through the host's guarded `kit.httpClient` with redirects refused, instead of the kit's unguarded `fetch`. A redirected answer is a refusal (the label stays unknown), so the credential is never replayed to another host.
