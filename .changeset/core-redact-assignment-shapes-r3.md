---
"@jini-ai/core": patch
---

Redaction: a `cookie=` assignment masks every `name=value` pair, a scheme word assigned to a non-header label (`password=Bearer`) is masked as the credential, and Google keys ending in `-` are masked through their last character.
