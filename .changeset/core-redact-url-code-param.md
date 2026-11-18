---
"@jini-ai/core": minor
---

`code` is no longer a URL secret word. A query or fragment parameter whose name only ends in it (`zipcode`, `promo_code`, `error_code`) keeps its value; the exact name `code` (an OAuth authorization code) and every other secret word (`token`, `key`, `secret`, `sig`, ...) are masked as before.
