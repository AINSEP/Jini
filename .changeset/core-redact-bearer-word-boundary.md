---
"@jini-ai/core": patch
---

The short-Bearer rule now needs `Bearer` to start a word, so a name that only ends in it (`TokenBearer`) no longer makes the next word read as a credential.
