---
"@jini-ai/core": minor
---

The shared redaction engine now serves chat's user text, so two of its answers change. A prose `Bearer <word>` (`Bearer token authentication`, `Bearer tokens`, `Bearer auth`, and similar scheme words, with at most one closing sentence mark) is kept instead of masked; a value that only starts with such a word (`Bearer auth-1a2b3c`) is still masked. An `sk-` key with 16 to 19 characters after the prefix is now masked (it needed 20 or more).
