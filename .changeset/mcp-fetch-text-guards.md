---
"@jini-ai/mcp": patch
---

Add opt-in byte caps and strict UTF-8 decoding to fetch-backed MCP HTTP exchanges. Guarded exchanges lazily use the optional platform peer (0.6.15 or later); default exchanges still work without platform installed.

Add opt-in per-frame stdio byte limits, FIFO handler/write scheduling, and EOF draining to the existing MCP tool host, preserving current defaults and factory signatures.
