---
"@jini-ai/core": patch
---

The shared engine reads a `Digest` credential as its whole parameter list, so a quoted parameter containing a space or comma (`realm="my realm"`, `response="abc def"`) no longer ends the match and leaves the rest of the response visible.
