---
"@jini-ai/core": patch
---

The shared engine masks a credential inside JSON that was escaped into a string (`{\"password\":\"x\"}`) and a command-line flag value (`--token=x`, `--password=x`), and reads an env-style name's value after blank lines when `=` follows the name.
