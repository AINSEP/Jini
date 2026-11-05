# Codex Peer Dispatch

Use this reference whenever an external peer workflow dispatches to `codex exec`
for `/debate`, `/consensus`, `/cowork`, `/audit-work`, or any packet-first peer
review.

## Required Transport

Codex peer prompts must begin with the deterministic peer marker:

```text
<<PEER_DISPATCH>>
```

The marker is the protocol-level startup bypass. `--ignore-rules` is still
required, but it is not enough by itself if the prompt or repo instructions can
make Codex behave like the primary interactive Coordinator. If a Codex peer emits
startup copy, `Coordinator(Review Mode)` bootstrapping text, or Mandatory Startup
behavior, stop that attempt and re-dispatch with the marker prepended.

Always pipe prompts via stdin with the `-` flag:

```bash
printf '%s\n\n' '<<PEER_DISPATCH>>' > "$RUN_DIR/codex-prompt.txt"
cat "$PACKET_PATH" >> "$RUN_DIR/codex-prompt.txt"

codex exec \
  --ignore-rules \
  --ignore-user-config \
  --ephemeral \
  --json \
  -s read-only \
  -m "$MODEL" \
  -C "$REPO" \
  - \
  < "$RUN_DIR/codex-prompt.txt" \
  > "$RUN_DIR/codex-output.jsonl" \
  2> "$RUN_DIR/codex-output.stderr"
```

Rules:

- Use `--ignore-user-config` for peer subprocess hygiene when all run-critical
  choices are explicit. It avoids user MCP/config/hook state contaminating the
  peer run.
- Because `--ignore-user-config` skips home defaults, always pass an exact
  `-m "$MODEL"` and any other needed runtime flags explicitly.
- Keep stderr separate. Codex writes session headers, command logs, and crashes
  there; stderr is diagnostics, not the peer answer.
- Parse the answer from JSONL `agent_message` items when `--json` is used.
- Do not use inline long prompts. `codex exec "long prompt"` and file-read
  instructions in read-only mode have both produced hangs or unusable output in
  prior peer workflows.

## Version Quarantine

Before assigning Codex any task that requires file, shell, web, or MCP tool use,
check the CLI version and host architecture:

```bash
codex --version
uname -s
uname -m
```

Known local failure class as of 2026-06-27:

- `codex-cli 0.142.3` on Intel macOS (`Darwin` + `x86_64`) can answer no-tool
  prompts but crashes with `Trace/BPT trap: 5` / `SIGTRAP` / exit `133` as soon
  as it invokes a tool.
- The same class has been reported for nearby `0.141.x` / `0.142.x` releases on
  Intel macOS. Treat the exact local smoke result as authoritative.
- `--ignore-user-config` is still peer-dispatch hygiene, but it does not fix the
  `0.142.3` tool-execution crash.
- `codex-cli 0.140.0` has been locally observed to complete shell/file tool
  execution in the same repo.

If the installed Codex version is in a known-bad range for the current host, do
not dispatch Codex for a tool-using peer task. Use one of these paths instead:

1. Use a known-good pinned Codex binary, such as `0.140.0`, for peer dispatch.
2. Restrict Codex to a self-contained no-tool reasoning prompt.
3. Mark Codex unavailable for that phase and continue only if the workflow's
   minimum viable peer count is still met.

Do not spend the full peer budget proving a known-bad runtime is still bad.

## Tool-Use Smoke

If Codex is expected to inspect repo files or run shell commands, run a cheap
tool-use smoke before the full peer task:

```bash
printf '%s\n\n%s\n' \
  '<<PEER_DISPATCH>>' \
  'Run: printf OK. Return only OK.' |
codex exec \
  --ignore-rules \
  --ignore-user-config \
  --ephemeral \
  --json \
  -m "$MODEL" \
  -C "$REPO" \
  - \
  > "$RUN_DIR/codex-smoke.jsonl" \
  2> "$RUN_DIR/codex-smoke.stderr"
```

If the smoke exits `133`, emits `Trace/BPT trap`, or returns no usable answer,
classify Codex as `codex_tool_execution_crash` for that phase. Do not run the
full task.

## Crash Handling

Observed failure signature:

- Codex starts normally.
- Stderr shows the session header and often the first assistant acknowledgement.
- The process exits with `SIGTRAP` / `Trace/BPT trap: 5` / exit `133` when tool
  execution begins.
- Stdout is empty or lacks a completed agent answer.

Handling:

1. If the failed command lacked the peer marker, stdin transport, explicit model,
   or `--ignore-user-config`, retry once with the canonical command above.
2. If the canonical retry also exits `133`, stop retrying Codex for that phase.
3. Record failure class `codex_tool_execution_crash`.
4. Exclude Codex from synthesis. Do not include partial stderr acknowledgements
   as a peer answer.
5. Continue only if the workflow still has the required minimum viable peer
   count.

Do not reclassify this as `malformed_or_no_output`, and do not keep trying
JSON-vs-text or sandbox-only variations after the canonical retry. Those do not
test the root failure.

## Single-Shot Dispatch

Use this for `/debate`, `/consensus`, `/audit-work`, or one-off `/cowork`
diagnosis where no session continuity is needed:

```bash
codex exec \
  --ignore-rules \
  --ignore-user-config \
  --ephemeral \
  --json \
  -m "$MODEL" \
  -C "$REPO" \
  - \
  < "$RUN_DIR/codex-prompt.txt" \
  > "$RUN_DIR/codex-output.jsonl" \
  2> "$RUN_DIR/codex-output.stderr"
```

## Multi-Phase Dispatch

Use this only when `/cowork` needs Codex session continuity across diagnosis,
verification, and correction phases.

Phase 1 captures the session ID:

```bash
printf '%s\n\n%s\n' '<<PEER_DISPATCH>>' 'Your task...' |
codex exec \
  --ignore-rules \
  --ignore-user-config \
  --json \
  -m "$MODEL" \
  -C "$REPO" \
  - \
  > "$RUN_DIR/codex-phase1.jsonl" \
  2> "$RUN_DIR/codex-phase1.stderr"
```

Extract `thread_id` from the `thread.started` JSONL event and store it in the
run folder. Later phases resume the same session:

```bash
printf '%s\n\n%s\n' '<<PEER_DISPATCH>>' 'Next task...' |
codex exec resume "$SESSION_ID" --json - \
  > "$RUN_DIR/codex-phase2.jsonl" \
  2> "$RUN_DIR/codex-phase2.stderr"
```

Rules:

- Session reuse is scoped to one workflow run.
- Do not reuse Codex sessions across different `/cowork`, `/consensus`, or
  `/audit-work` runs.
- If `resume` fails, classify the peer failure and start a fresh session only
  when the workflow can tolerate losing prior Codex context.
