---
"@jini-ai/diagnostics": patch
---

Best-effort cleanup that used to swallow its failure (closing a browser or page context, aborting or fulfilling a route, cancelling a reader, recording an async error report) now logs at debug what was being done and the cause's redacted message. A failed log-source read keeps the cause's redacted message (and a thrown string's redacted text).
