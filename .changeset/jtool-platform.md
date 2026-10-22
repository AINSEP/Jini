---
"@jini-ai/platform": patch
---

Preserve page-reader emphasis, raw Markdown text and inline-code whitespace; cap HTML before synchronous conversion.

The library projection retains its definition-list, fenced-code language, q/kbd, explicit hard-break and compact GFM table serialization. Ordinary text remains unescaped.
