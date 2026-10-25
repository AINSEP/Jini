---
"@jini-ai/agent-runtime": patch
"@jini-ai/daemon": patch
---

Folder-limited Claude runs get a private per-run CLAUDE_CODE_TMPDIR (a 0700 /tmp/jini-* directory, removed on exit, crash, cancellation or startup failure). The sandbox grants only that run's scratch subtree; the shared per-user /tmp/claude-<uid> grant is gone, and overlong bases are refused instead of falling back to shared scratch.
