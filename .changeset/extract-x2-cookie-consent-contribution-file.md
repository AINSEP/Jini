---
"@jini-ai/cookie-consent": patch
---

`@jini-ai/cookie-consent/plugins` also exports `parseConsentContributions`, `consentBridgeContribution` and `declaredScriptsContribution`: pure rules for a plugin's schema-2 consent contribution file (region readers, browser bridges and declared scripts). Unknown kinds are skipped; loading and activation stay with the host.
