# Claude Code CLI Packet Audits

Use this reference when the external auditor or peer reviewer is Claude Code CLI and the workflow is packet-first or file-inspecting.

## Preferred Pattern

For Claude packet audits, prefer this shape:

1. Build a packet first.
2. Use a peer-readable dispatch copy.
3. Keep the prompt short and point Claude at the packet path instead of embedding the whole packet inline.
4. Keep the file set bounded when the packet already names the relevant files.
5. Require an `Auditor Scope Check` before findings.
6. Prefer a constrained `Read`-only tool surface when that is sufficient.
7. If available, use the dedicated runner script at `<AI_DEV_SHOP_ROOT>/skills/external-audit/scripts/run_claude_packet_audit.py` instead of ad hoc shell capture.
8. Pass an exact `--model` to the runner when the workflow promises exact model reporting.
9. Pass `--effort <low|medium|high|xhigh>` when the user requests a specific Claude
   reasoning effort; do not rely on the local default.
10. When the audit workflow requests suggested changes, pass the runner's `--suggest-changes <patches|notes|none>` flag so the fallback prompt preserves the same mode.
11. For a long or xhigh audit, use `--audit-output-format stream-json`. The runner
    adds `--verbose`, writes the event stream incrementally, emits the mandatory
    30-second heartbeats, and parses the terminal result event. If a buffered audit
    already timed out, reuse the same frozen packet and change transport/timeout
    deliberately rather than repeating the failed invocation.
12. Before discovery, check whether the exact requested Claude model already succeeded earlier in the current session on this same host/CLI. If yes, reuse it as `session_success` proof and skip the smoke test.
13. If the requested Claude model is still unproven after that session-success check, or it is rejected, run `skills/swarm-consensus/scripts/cli_smoke_test.py --discover-claude --claude-require both --output-format json` and use the proven winner only if it matches the requested family/version. Otherwise stop and ask the user.
14. Treat `<ADS_MEMORY_ROOT>/reports/swarm-consensus/smoke-tests/last-known-good.json` as the retained environment-scoped cache. A cache hit is valid only when the host/OS/machine/Claude CLI version/transport tuple matches and the cached artifact path still exists.
15. Absence of that cache file alone is not enough reason to rerun discovery when the exact model already has in-session proof.

## Observed Transport Quirks

- Claude JSON mode can return a success wrapper with an empty final `result` even when real internal work happened.
- Redirected stdout/stderr files may stay zero-byte while the Claude process is still alive and only flush on exit.
- Quiet runtime by itself is not a failure signal for Claude packet audits.
- `claude -p --output-format=stream-json` requires `--verbose`; do not assume `stream-json` is a drop-in replacement for plain `json` mode.

## Timing Guidance

- Keep the configured audit timeout as the hard ceiling.
- Do not treat a live Claude process with empty redirected offload files as stalled by itself.
- If you need a soft suspicion threshold for a Claude packet audit, use roughly `90s`, not `30-40s`.

## Failure Handling

- Only classify `empty_result_transport_failure` after the Claude process exits successfully and stdout is still empty.
- If that happens, retry once with a tighter bounded prompt and a constrained read-only tool surface.
- If a plain-text fallback is used after an empty JSON result, keep that retry on a shorter bounded timeout instead of reusing the full audit timeout.
- Always persist the raw JSON/text stdout and stderr offloads for Claude audit runs, including successful ones.

## Local Proof In This Repo

This repo has locally reproduced all of the following:

- successful readability probes
- successful bounded packet audits
- successful packet audits via the dedicated runner script
- `success + empty result` JSON failures on some Claude packet runs

Treat this file as the canonical Claude-specific transport note for peer-audit flows in this repo.
