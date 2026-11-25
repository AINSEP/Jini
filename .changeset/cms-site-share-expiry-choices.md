---
"@jini-ai/cms": minor
---

`GET …/site-shares` now answers `expiryChoices` beside `shares`: `null` (Never) first and the default, then the whole positive day counts from the host backend's new optional `SiteShareRouteBackend.expiryChoices()`. A backend without that method answers `[null]` (Never only).
