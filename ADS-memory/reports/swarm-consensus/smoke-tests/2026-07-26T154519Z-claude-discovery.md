# Swarm Consensus CLI Smoke Test

- Generated at: `2026-07-26T15:45:19.645891+00:00`
- Host: `LAs-MacBook-Pro`
- Working directory: `/Users/la/Programming/Jini/AI-Dev-Shop`
- Prompt: `Reply with OK and then <<SWARM_END>> only.`
- Case timeout: `75s`
- Codex --cd: `/Users/la/Programming/Jini/AI-Dev-Shop`
- agy --cd: `/tmp`

## CLI Versions

| CLI | Path | Version |
|---|---|---|
| `claude` | `/Users/la/.npm-global/bin/claude` | `2.1.220 (Claude Code)` |
| `gemini` | `/Users/la/.npm-global/bin/gemini` | `timeout` |
| `codex` | `/Users/la/.npm-global/bin/codex` | `codex-cli 0.145.0` |
| `agy` | `/Users/la/.local/bin/agy` | `1.1.7` |

## Model Resolution

| CLI | Requested | Resolved | Selection Source | Note |
|---|---|---|---|---|
| `claude` | `claude-opus-5` | `claude-opus-5` | `requested_model` | `discovery requirement=json` |
| `gemini` | `n/a` | `gemini-3.1-pro-preview` | `local_default` | `from ~/.gemini/settings.json` |
| `codex` | `n/a` | `gpt-5.6-sol` | `local_default` | `from /Users/la/.codex/config.toml; reasoning=high` |
| `agy` | `n/a` | `Gemini 3.1 Pro (High)` | `default` | `agy replaces gemini CLI; run from /tmp to avoid AGENTS.md pickup` |

| Case | Status | RC | Dur (s) | JSON-ish stdout | Parsed end marker | stdout | stderr |
|---|---|---|---:|---|---|---:|---:|

## Claude Discovery

- Requirement: `json`
- Saved Claude model: `opus[1m]`
- Requested Claude model: `claude-opus-5`
- Requested Claude family: `opus`
- Saved Claude family: `none`
- Cache hit: `False`
- Cache path: `/Users/la/Programming/Jini/ADS-memory/reports/swarm-consensus/smoke-tests/last-known-good.json`
- Candidate ladder: `/Users/la/Programming/Jini/AI-Dev-Shop/skills/swarm-consensus/references/model-candidate-ladders.json`
- Winning model: `claude-opus-5`
- Winning source: `requested_model`

| Candidate | Source | Success | JSON OK | Text OK | Suggested Models |
|---|---|---|---|---|---|
| `claude-opus-5` | `requested_model` | `True` | `True` | `False` | `none` |

