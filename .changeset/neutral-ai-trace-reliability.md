---
"@jini-ai/agent-runtime": patch
"@jini-ai/daemon": patch
"@jini-ai/protocol": patch
---

Apply AI-trace capture policy to errors, contain tracing and sink failures, preserve canonical
usage and stop reasons, accumulate request usage snapshots, scope tool identities per request,
and finalize traces from committed terminal events including inactivity watchdog completion.
Provider/session trace mappers now receive object arguments.
