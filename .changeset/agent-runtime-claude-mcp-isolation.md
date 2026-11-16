---
"@jini-ai/agent-runtime": patch
---

The Claude agent definition now declares `mcpIsolation` (per-run, via `--strict-mcp-config`), so `planRun` no longer asks for MCP consent on an isolated Claude run.
