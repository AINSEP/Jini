---
"@jini-ai/agent-runtime": minor
"@jini-ai/daemon": minor
---

Drive Antigravity (`agy`) — the 24th and last agent definition `AgentExecutor` rejected.

`AgentExecutor` drove 23 of 24 registered definitions. Antigravity was rejected by an explicit
`def.id === 'antigravity'` guard, for two reasons that are real but narrow:

- **`agy` can print an OAuth sign-in URL to stdout and still exit 0.** Streaming stdout live shows
  that URL to the user as if it were the model's reply — a URL that carries the daemon operator's
  `client_id`/`redirect_uri` into a chat transcript, and that is useless to click anyway (`agy -p`
  print mode has no field to paste the resulting auth code into).
- **`agy` has no `--model` flag.** The model choice is written into one process-global
  `~/.gemini/antigravity-cli/settings.json` that `agy` reads on its own startup, so two concurrent
  runs race: run A writes model A, A spawns, B writes model B, and only *then* does A's `agy` read
  the file — so A silently executes on B's model.

Both are now met by **declarative `RuntimeAgentDef` fields the executor reads generically**, joining
the 14 optional behavior flags (`promptViaFile`, `authProbe`, …) that already work this way. There is
no agent-id branch anywhere in the dispatch path — a deliberate divergence from Open Design's own
daemon, which hardcodes the id twice.

New on `@jini-ai/agent-runtime`'s `RuntimeAgentDef`:

- `needsAgentLogFile?: boolean` — asks the caller to stage a temp path and pass it as
  `RuntimeContext.agentLogFilePath` before `buildArgs` runs, mirroring `promptViaFile`. Staged by the
  new `prepareAgentLogFile(def, label)` (the sibling of `preparePromptFileForAgent`; it creates only
  the `0o700` containing directory, since the log file is output the CLI authors, not input we do).
- `stdoutPolicy?: RuntimeStdoutPolicy` — `{buffering: 'live'}` (the default, and every other
  definition's behavior) or `{buffering: 'until-close', sanitize?}`. A discriminated union rather
  than two flat fields on purpose: a sanitizer is only meaningful on the buffered path, because the
  pattern to redact can straddle two `'data'` chunks. Two independent flags would let a definition
  declare a sanitizer the caller could not honor — a confidentiality gap that *looks* closed.
- `runtimeLock?: RuntimeLock` — a mutex around a process-global side effect `buildArgs` performs.
  Acquired before `buildArgs`, released on whichever of `waitForHandoff` settling or process exit
  comes first. Releasing on exit is load-bearing, not a fallback: a watcher that stops polling means
  "I stopped watching", never "the child definitely didn't read the file".

All three are stripped from the `DetectedAgent` registry projection. They instruct whoever *spawns*
the CLI, not whoever lists agents — and two carry closures, which `JSON.stringify` would flatten into
a misleading `{"buffering":"until-close"}` / `{}` rather than omit.

In `@jini-ai/daemon`, `AgentExecutor` now stages a log file when `needsAgentLogFile` is set (released
on every pre-spawn, spawn-failure, and close path alongside the prompt file, through one composed
`cleanupStagedFiles` closure), calls `runtimeLock.acquire()` before `buildArgs`, and branches its
`streamFormat: 'plain'` stdout handling on `stdoutPolicy`. `assessAgentExecutorCompatibility` no
longer rejects anything by id, and `isAgentExecutorSupported` now accepts all 24 definitions.

**No behavior change for any other agent.** Antigravity is the only definition declaring any of the
three fields; the other four `streamFormat: 'plain'` definitions (`grok-build`, `aider`, `deepseek`,
`qwen`) keep streaming live, per chunk, which `aider`'s and `deepseek`'s own comments call out as
deliberate. That is pinned by an explicit regression test rather than left implied.

One thing worth knowing if you consume the run event stream: on the buffered path the raw `'stdout'`
echo is held back and sanitized too, not just the `'agent'`/`text_delta` copy. Emitting an
unsanitized raw echo while withholding the chat copy would leak the exact string the sanitizer exists
to remove to any subscriber. The opt-in byte journal still records raw bytes per chunk — that is its
documented contract, and it deliberately lives in a separate `EventLog` instance that is never
replayed to run-event subscribers.
