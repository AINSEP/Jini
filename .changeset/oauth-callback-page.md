---
"@jini-ai/oauth": minor
---

`@jini-ai/oauth/callback-page` exports `renderOAuthCallbackPage({ ok, messageType, reason, copy }, { lang?, successCloseMs?, failureCloseMs? })`, the OAuth popup landing page. Nothing from the request is interpolated, the host supplies every copy string (HTML-escaped) and the closed failure-reason vocabulary, and an unknown reason renders the default reason's copy.
