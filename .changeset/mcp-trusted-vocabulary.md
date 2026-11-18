---
"@jini-ai/mcp": minor
---

Model-facing errors keep the names the caller may read. Each call builds its vocabulary (the called tool's schema property names; for a gateway call the descriptor this run holds, else the envelope's `details.inputNames`; the envelope's `toolId`, `executionId`, `jobId`, `requestId`; the caller's own slug arguments except secret-marked ones) before the daemon is asked, and both format passes use it. `McpToolContext` gains `diagnosticVocabulary` and `descriptorFor`; `DaemonRequestOptions` gains `trustedTokens`. `diagnosticToolIds` keeps its meaning and is never extended by the vocabulary.
