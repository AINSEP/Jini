---
"@jini-ai/core": patch
---

Redaction: after `label:` and a line break (blank lines allowed), a single token or a credential-shaped first token on the next line is masked for the engine's labels and the alias names alike; a value glued after a quoted `"password: "` hint is masked; a line of plain words stays readable.
