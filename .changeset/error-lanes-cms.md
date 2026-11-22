---
"@jini-ai/cms": patch
---

Form-notify and content-deleted warnings send fixed words to the host `logger` and pass the caught value as `{ error }` meta instead of a pre-formatted string; site comment/form submit failures log the error class only. **Host action:** a custom `logger` that stringified the meta must redact the `error` object itself before storing it.
