---
"@jini-ai/admin": minor
"@jini-ai/cookie-consent": minor
"@jini-ai/core": minor
---

The built-in consent banner label no longer spells a Jini product name: `consentTranslation` now requires `productName` (the dictionary key is `{productName} banner`), `ConsentFieldsProps` gains an optional `productName` (fallback "Built-in banner"), and the `site_guide` search keywords end with the host's product name instead of "Jini".
