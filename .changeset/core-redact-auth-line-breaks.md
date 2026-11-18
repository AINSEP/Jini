---
"@jini-ai/core": patch
---

Redaction: an auth header's scheme word and credential are masked when they sit on the lines after the header name, and a bare Basic/Token credential is masked after any run of whitespace.
