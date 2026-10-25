---
"@jini-ai/agent-runtime": patch
"@jini-ai/daemon": patch
"@jini-ai/protocol": patch
"@jini-ai/server": patch
---

Apply AI-trace capture policy to errors, contain tracing and sink failures, preserve canonical
usage and stop reasons, accumulate request usage snapshots, scope tool identities per request,
and finalize traces from committed terminal events including inactivity watchdog completion.
Provider/session trace mappers now receive object arguments.
A trace whose stream subscription is refused or rejects after `run_started` is now finished from
the run's real terminal state (`waitForTerminal`, in the background) instead of being dropped.
`RunLifecycle.waitForTerminal` takes an optional `{ signal }`: aborting it rejects with the reason and
unregisters the waiter. The traced lifecycle gains `dispose()`, which releases open traces without
finishing them and cancels those background waits; the server kernel's `close()` calls it after the
agent runtime stops, so a retained kernel keeps no recorder or waiter.
