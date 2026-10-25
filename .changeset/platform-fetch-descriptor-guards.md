---
"@jini-ai/platform": patch
---

Add optional fetch injection, bounded/strict UTF-8 response text reading, text consumption within the fetch timeout scope, and descriptor-based guarded file reads. Existing defaults and positional fetch signatures remain unchanged.

Add an opt-in details overload to readFetchResponseText with retained-byte metadata, bounded-prefix truncation, and abortable reads with prompt cleanup. fetchTextWithTimeout now races every body read against its timeout, so an injected transport whose body ignores the abort signal still times out.
