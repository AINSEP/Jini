---
"@jini-ai/platform": patch
---

Fix two platform bugs. B133: `EnvOrFileKeyring` now creates an auto-generated root key file exclusively (`wx`, mode 0600) and, when another process created it first, reads and uses that key instead of overwriting it. B046: the guarded file reader's "could not be read" refusals now give a plain reason derived from the error code (for example "it does not exist (ENOENT)") instead of the native error message, which contained the absolute host path.
