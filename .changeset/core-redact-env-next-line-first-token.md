---
"@jini-ai/core": patch
---

After a prefixed credential name followed by `=` and a line break, the first token of the next line is masked even when words follow it on that line, as the engine already does for `password=`. A colon still needs the line to be one bare token.
