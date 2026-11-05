# Swarm Consensus CLI Smoke Test

Use this before changing preferred peer models, updating flag recommendations, or trusting a new CLI release.

What this does:

- checks which flag orderings and output modes still work on the current host
- compares text vs structured output where available
- shows whether the peer answer survives end-marker parsing
- shows how much diagnostic noise lands on `stderr`
- helps detect repo-local behavior differences, especially for `codex exec`
- can probe candidate Claude model names and return the first locally proven working exact model
- can expand a maintained candidate ladder (`model-candidate-ladders.json`) newest-to-oldest instead of guessing ad hoc
- resolves model plans from project knowledge and repo-local evidence before falling back to home CLI defaults
- writes a dated Claude discovery artifact plus an environment-keyed last-known-good cache when discovery mode is used
- keeps retained proof under `reports/swarm-consensus/smoke-tests/` by default, with dated history snapshots for cache updates

Run it with current preferences:

```bash
python3 skills/swarm-consensus/scripts/cli_smoke_test.py \
  --claude-model us.anthropic.claude-opus-4-6-v1 \
  --agy-model "Gemini 3.1 Pro (High)" \
  --codex-model gpt-5.5 \
  --save-artifact
```

Resolve the saved model plan without dispatching peer prompts:

```bash
python3 skills/swarm-consensus/scripts/cli_smoke_test.py \
  --model-plan-only \
  --output-format json
```

`--model-plan-only` is the mechanical implementation of the `Model Memory Map` in
`skills/llm-operations/references/peer-llm-dispatch.md`. That map is the only place the
lookup order, the evidence rules, and the explicitly-invalid sources are written; this
document deliberately does not restate them, because a second copy drifts from the first.

If a Claude model is requested but rejected or unproven locally, run discovery first:

```bash
python3 skills/swarm-consensus/scripts/cli_smoke_test.py \
  --discover-claude \
  --claude-model claude-opus-4-6 \
  --claude-require both \
  --output-format json
```

Interpret the discovery result this way:

- discovery first tries any explicit request, then the requested family ladder, then saved/default-family fallbacks from `skills/swarm-consensus/references/model-candidate-ladders.json`
- use the discovered `winner.model` when it matches the requested family/version and the required transport mode
- if discovery finds only an older or different model family/version, stop and ask the user before switching
- prefer `--claude-require json` for consensus runs that stay in structured-output mode
- prefer `--claude-require both` for Claude audit flows that may need plain-text fallback
- discovery mode auto-saves a dated artifact under `<ADS_MEMORY_ROOT>/reports/swarm-consensus/smoke-tests/`
- discovery mode also updates `<ADS_MEMORY_ROOT>/reports/swarm-consensus/smoke-tests/last-known-good.json`
- each cache update also writes a dated snapshot under `<ADS_MEMORY_ROOT>/reports/swarm-consensus/smoke-tests/history/`
- the script still falls back to the legacy `.local-artifacts/swarm-consensus/smoke-tests/last-known-good.json` cache if the retained cache is missing
- cache hits are valid only for the same environment tuple: hostname, OS, machine, and transport requirement, and only when the cached artifact path still exists. Claude CLI version is recorded as diagnostics but does not invalidate model proof by itself.

Run Codex in an isolated directory to compare raw CLI behavior against repo-local behavior:

```bash
python3 skills/swarm-consensus/scripts/cli_smoke_test.py \
  --codex-model gpt-5.5 \
  --codex-cd /tmp \
  --save-artifact
```

Suggested operating pattern:

- run a dated baseline once after setting up consensus on a host
- rerun after CLI upgrades, major model-family changes, or parser regressions
- save retained runs and discovery proof in `<ADS_MEMORY_ROOT>/reports/swarm-consensus/smoke-tests/` by default
- use `<ADS_MEMORY_ROOT>/.local-artifacts/swarm-consensus/smoke-tests/` only when you explicitly want a transient local-only run
- treat the saved artifact as evidence for updating saved model preferences or slash-command guidance
- do not treat one machine's winning Claude model string as globally valid for other environments
- treat dated snapshots as staleness indicators for human review, not as an automatic rerun trigger

Interpretation rules:

- prefer cases that keep the answer in `stdout` and diagnostics in `stderr`
- prefer structured output when it still preserves the peer answer cleanly
- if a model flag fails, do not update the slash command to assume it; confirm the correct flag pattern first
- if a requested Claude model fails, do not keep guessing manually; run discovery and use the proven winner or stop
- update the ladder file when a newer exact model ID becomes available or an older one is retired
- if there is no exact environment cache hit and no fresh discovery artifact, Claude is not yet proven for that environment
- if a newer model family looks better, update the saved preference only after rerunning this test
- runtime `/consensus` and `/debate` runs must not dispatch peers with inferred, alias-only, exact-unknown local-default, or unknown exact model IDs. Show the block and require exact pins or a fresh smoke-test/model-plan proof before the normal peer-dispatch `run` gate.
