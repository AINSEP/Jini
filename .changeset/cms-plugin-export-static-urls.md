---
"@jini-ai/cms": minor
---

Classify the plugin export template URL restriction as a breaking pre-1.0 change. The original patch changeset was consumed in 0.6.13 by f8056e2cb; this minor release records the required compatibility boundary. Templates must use a whole quoted `{{host.<link>}}` or `{{host.assets.<asset>}}` slot in `href`, `src`, and `action`. Literal paths, fragments, external URLs, and URL concatenation are refused and retain the authored embed fallback. Host links are flattened into `host`, not nested under `host.hostLinks`.
