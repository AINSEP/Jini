---
name: swarm-consensus
version: 1.7.0
last_updated: 2026-05-13
description: Orchestrate a multi-model swarm by dispatching a prompt to all available LLM CLIs (whichever ones are installed), collating independent responses, and synthesizing a consensus. Supports single-pass and debate modes. Model-agnostic — the primary model is whoever is currently running this skill. OFF by default.
---

# Skill: Swarm Consensus

**This skill is OFF by default.** Only invoke it when explicitly instructed by the user or the Coordinator.

## When to Use

- User explicitly requests "consensus", "swarm analysis", or uses the `/consensus` command
- User explicitly requests "debate" or uses the `/debate` shortcut command
- Coordinator directs a specific agent to use Swarm Consensus for a single hard task
- An ADR has profound architectural consequences and requires multi-perspective validation
- Red-Team is probing a spec for blind spots that a single model might miss

## Debate Routing Guard (Blocking)

When the user asks for a debate, uses `/debate`, asks for a "2 round debate", or requests multiple agents/models to argue a question, this skill is the default route.

- Debate requests must use external peer LLM CLIs by default.
- Platform subagents, current-LLM helper agents, repo-persona consultations, and same-family child agents must not be used to satisfy debate requests unless the user explicitly asks for current-LLM subagents, local subagents, repo-persona debate, or cross-agent consultation.
- If external peer CLIs are unavailable, report that and stop or follow this skill's graceful fallback rules. Do not silently replace Swarm Consensus debate with platform subagents.
- Before dispatch, announce that the run is `Swarm Consensus debate` and list the external peers found by the prerequisite check.

## Model Identity Disclosure Guard (Blocking)

When naming LLM participants to the user, always show the peer model identity first.

- Use model names or model IDs such as `Claude: <resolved-model>`, `Gemini: <resolved-model>`, and `Codex: <resolved-model>`.
- Do not present CLI version strings such as `2.1.84`, `0.38.1`, or `codex-cli 0.125.0` as model names or model versions.
- CLI versions belong only in diagnostics, smoke-test evidence, or the `CLI Version` column of the final report.
- If the exact model cannot be proven, say `model unresolved` or `local default, exact model unknown`; do not substitute the CLI version. For `/consensus` and `/debate`, that unresolved label is a blocking status and must not be dispatched.
- Preflight copy must distinguish `Planned peer models` from `CLI diagnostics`.

**Mode-entry disclosure line.** A command that announces consensus is available
states this promise to the user, verbatim, rather than paraphrasing it:

`I will show model identity first in preflight, with CLI versions only as diagnostics. If any model is inferred instead of explicitly pinned for this run, I will ask you to confirm or override it first.`

User-facing wording lives here with the rule it promises. A command that restates
it in its own words is a second copy that drifts from this one.

### Reporting Results to User (Blocking)

When reporting debate results, synthesis, decision ledgers, or any peer output back to the user, always identify each participant by **model family + version + reasoning mode** — not by CLI name alone.

Examples of correct reporting:
- `Gemini 3.1 Pro` (not "Gemini" or "gemini-cli")
- `Codex GPT-5.5 xhigh` (not "Codex" or "codex-cli")
- `Claude Opus 4.6` (not "Claude" or "claude-cli")

If the model reports its own identity in the response (e.g., Codex session headers show `model: gpt-5.5`), use that. If reasoning effort is known (e.g., `xhigh`, `high`), include it. The user must always know exactly which model produced which output.

## Model-Agnostic Design

**You are the primary model.** Whatever LLM is currently running this skill is the primary reasoner. You generate your own response first, then dispatch the same prompt to any other available CLI tools, and synthesize the combined output.

The peer CLIs are external — they run as subprocesses via shell and return `stdout`. You do not know in advance which ones are installed. The prerequisite check determines this at runtime.

For shared packet, transport, diagnostics, and capability-discovery rules that apply beyond consensus, use `skills/llm-operations/references/peer-llm-dispatch.md`.

Supported peer CLIs:

| CLI | Invocation | Notes |
|---|---|---|
| `claude` | `claude -p --output-format json "<prompt>"` | Claude Code CLI. Prefer structured output when available. |
| `agy` | `cd /tmp && script -q /dev/null agy --model "Gemini 3.1 Pro (High)" --dangerously-skip-permissions --print "<<PEER_DISPATCH>>\n<prompt>"` | Gemini peer via agy CLI (replaces sunsetted `gemini` CLI). **MUST wrap in a pseudo-TTY (`script -q /dev/null ...`)** — known agy bug (Antigravity #76): `--print` checks isatty() and, under a file/pipe/subprocess redirect (non-TTY), hangs forever waiting for an approval prompt that never renders, emitting zero bytes until the 5m `--print-timeout`. The `script` pty defeats this. Also lead the prompt with `<<PEER_DISPATCH>>` (bypasses AGENTS.md interactive startup) and pass `--dangerously-skip-permissions`. **Run with `cwd=/tmp`**. Output carries ANSI/spinner codes — strip with `perl -pe 's/\e\[[0-9;?]*[a-zA-Z]//g; s/\r//g'`. Default model: `Gemini 3.1 Pro (High)`. No JSON mode. Diagnostic: `agy models` returns instantly when auth is healthy, so a `--print` hang is the TTY bug, not auth. Newer agy may add native `--headless`/`--output`/`--format json` flags that replace the pty wrapper. |
| `codex` | See `skills/llm-operations/references/codex-dispatch.md` | OpenAI Codex CLI. Use the dedicated Codex dispatch reference for peer-marker, stdin transport, version quarantine, `--ignore-user-config`, and exit-133/tool-use crash handling. |

If you are Claude Code, you dispatch to `agy` and `codex`. If you are running via `agy` (Gemini), you dispatch to `claude` and `codex`. The skill works identically regardless of who is primary.

### Participant Roles

- The current host model is already the `Primary` participant in the swarm and in debate mode.
- Do not add a same-family child/subagent as an extra voting peer by default. That weakens independence and can overweight one model family.
- If the user explicitly wants a same-family helper, use it only for context-packet preparation, adversarial review, or synthesis critique. Record it as a non-voting helper in run notes or diagnostics, and exclude it from agreement math and the Decision Ledger.

### Primary Participation Guard (hard requirement)

- The current host model MUST contribute a substantive first-pass response before any peer synthesis, debate, or final recommendation.
- A consensus run that only relays peer outputs is invalid. Do not present peer-only debate as consensus.
- If the host environment cannot cleanly surface the current host model's own first-pass response, create exactly one same-family child/helper to supply that frozen first-pass response before reading peer outputs.
- That same-family child/helper fills the `Primary` slot only. It is not an extra voting peer, must not create a fourth vote, and must not be counted separately in agreement math.
- If neither the host model nor a same-family child/helper can provide a substantive primary response, stop and report the run as invalid instead of returning a peer-only result.

---

## Consensus Modes

Pick one mode explicitly at run start:

- `single-pass` (default): independent first-pass answers from all models, one synthesis pass, then final recommendation.
- `debate`: independent first-pass answers, then bounded rebuttal rounds, then final recommendation.

If the user does not specify mode, use `single-pass`.

---

## Runtime Controls

Consensus runs accept runtime controls from the user:

- `max_rounds=<int>`: maximum rebuttal rounds (default `2` when mode is `debate`)
- `min_confidence=<0.0-1.0>`: minimum agreement threshold to stop early (default `0.90`)
- `swarm_timeout_seconds=<int>`: total wall-clock budget for the full consensus run across all peer calls and debate rounds (default `300`)
- `claude_model=<id>`: per-run Claude model override
- `gemini_model=<id>`: per-run Gemini model override
- `codex_model=<id>`: per-run Codex model override

If controls are not provided, use defaults. In `single-pass`, `max_rounds` is unused. In `debate`, default to `2` rounds unless the user overrides it. If provided values are invalid, state the invalid value and fall back to defaults.

---

## Step 1 — Prerequisite Check + Preflight

Before dispatching anything, run these checks via shell:

```bash
which claude && claude --version 2>/dev/null || echo "claude: not installed"
which agy    && agy    --version 2>/dev/null || echo "agy: not installed"
which codex  && codex  --version 2>/dev/null || echo "codex: not installed"
which gemini && gemini --version 2>/dev/null || echo "gemini: not installed (sunsetted)"
```

From the output:
- Record which CLIs are available (installed and returning a version)
- Record the CLI version string separately from the resolved model ID — these are not the same thing, and CLI version must never be displayed as model identity
- Skip any CLI that is not installed — do not error, just note it as absent in the report
- Check for any user-saved model version preferences (e.g. from a prior "always use Opus for consensus" instruction) and apply them via CLI flags if the tool supports it
- Before any peer prompt preview or dispatch, run the Model Memory Map using the smoke-test harness in model-plan mode:
  `python3 skills/swarm-consensus/scripts/cli_smoke_test.py --model-plan-only --output-format json`
- Work that map in full for the lookup order and the evidence rules. Do not rely on CLI version output for model identity.
- Run preflight transparency announcement before asking any model:
  - `Planned peer models: Claude=<exact-model-or-not-installed>, agy/Gemini=<exact-model-or-not-installed>, Codex=<exact-model-or-not-installed>.`
  - `CLI diagnostics: Claude CLI=<version-or-not-installed>, agy CLI=<version-or-not-installed>, Codex CLI=<version-or-not-installed>.`
  - If a CLI is missing, mark its model as `not installed` and its CLI diagnostic as `not installed`.
- If an installed peer's exact model ID cannot be proven before dispatch, this is a blocking condition, not a confirmation gate. Do not ask the user to reply `run` for unresolved or local-default models. Stop and ask for exact model pins, or ask whether to run/update the smoke test first.

A minimum viable swarm is **primary model + 1 peer**. If no peers are available, tell the user and stop — running consensus with only one model produces no value. **This is a graceful stop, not a pipeline failure.** If Swarm Consensus was invoked as part of a pipeline stage, that stage proceeds using the primary model's output alone — the pipeline is not blocked by missing peer CLIs.

### Model Selection Resolution Protocol

Before dispatching prompts, resolve the planned model for each available peer CLI by
working the `Model Memory Map` in
`skills/llm-operations/references/peer-llm-dispatch.md`. That map is the only place the
lookup order, the evidence rules, and the explicitly-invalid sources are written. The
smoke-test harness implements that order with `--model-plan-only`.

For each peer, record:

- `requested_model`: what the run asked for, if anything
- `resolved_model`: the exact model ID proven from CLI config/output, if available
- `selection_source`: `per_run_override`, `saved_preference`, `home_cli_exact_default`, `local_default` with exact `command_model`, `smoke_test_discovery`, `session_success`, or `unknown`

If any installed peer model is not exact, is alias-only, is inferred from a local default without an exact `command_model`, or the exact resolved model ID cannot be proven, stop before packet preview or dispatch and tell the user:

- which installed peer models are blocked
- which smoke-test/cache/model-plan sources were checked
- how to proceed: provide exact `claude_model=...`, `gemini_model=...`, `codex_model=...` pins or approve running/updating the smoke test

Use this pattern:

`Blocked: exact peer model is not proven for <peer-list>. Checked smoke-test model plan and saved model evidence. Reply with exact model pins (claude_model=..., gemini_model=..., codex_model=...) or say "run smoke test" to prove current models. I will not dispatch peers with unresolved, alias-only, or exact-unknown local defaults.`

`run` is not a valid response to this model-proof block. The normal peer-dispatch `run` gate is available only after every installed peer selected for the swarm has an exact planned model ID.

Do not silently upgrade a peer to a newly released model family/version just because it exists. If a newer model may be better, tell the user and let them choose.

If the Claude peer model is requested, first check whether that exact model already succeeded earlier in the current session on this same host/CLI. If yes, treat that as `session_success` proof and reuse it directly. Do not rerun discovery just because the cache file is absent.

If the Claude peer model is still unproven after the session-success check, or the CLI rejects the requested model name, do not keep guessing manually. Run the smoke-test harness in discovery mode first:

```bash
python3 skills/swarm-consensus/scripts/cli_smoke_test.py \
  --discover-claude \
  --claude-model <requested-or-saved-model> \
  --claude-require json \
  --output-format json
```

Use the discovered `winner.model` only when it is the same requested family/version and it passed locally in JSON mode. If discovery finds only a different family/version, stop and ask the user before switching.
A valid Claude proof is any one of:
- an exact environment cache hit from `<ADS_MEMORY_ROOT>/reports/swarm-consensus/smoke-tests/last-known-good.json` with a real artifact path
- an exact-model `session_success` earlier in the current session on the same host/CLI
- a fresh discovery run that writes a new artifact for the current environment
Discovery should expand the maintained ladder at `skills/swarm-consensus/references/model-candidate-ladders.json`: explicit request first, then requested-family candidates newest-to-oldest, then saved/default-family fallbacks. Keep this deterministic and auditable rather than improvising model guesses during a live debate.

### Freshness policy

Consensus runs should avoid silently drifting to newer model families/versions.

- Claude: use `--model` when the user or a saved preference pins one.
- agy (Gemini): use `--model` when the user or a saved preference pins one.
- Codex: use `-m` when the user or a saved preference pins one.

If a configured model appears stale, unavailable, preview-only, alias-based, or unknown, state it before the run and stop. Continue only after the user supplies exact pins or a smoke-test/model-plan run proves exact model IDs. Do not dispatch consensus/debate peers with `local default, exact model unknown`.

### Smoke-Test Reference

Before changing saved consensus model preferences or updating the command docs to prefer a new flag pattern, rerun the CLI smoke-test harness:

- Script: `skills/swarm-consensus/scripts/cli_smoke_test.py`
- Guide: `skills/swarm-consensus/references/cli-smoke-test.md`

Use the smoke test to compare text vs structured output, stderr noise, end-marker behavior, and explicit model-flag handling on the current host.

By default, save smoke-test artifacts and the cross-session proof cache to `<ADS_MEMORY_ROOT>/reports/swarm-consensus/smoke-tests/`.
If the user explicitly wants a transient local-only run, set `--artifacts-dir <ADS_MEMORY_ROOT>/.local-artifacts/swarm-consensus/smoke-tests`.

If the dated artifacts suggest the proof may be stale for the current host, surface that plainly and let the user decide whether to rerun the smoke test. Staleness is advisory only; do not rerun automatically.
If a Claude model-resolution failure happens during a live consensus preflight, run the smoke test immediately instead of asking the user to guess another Claude model by hand.

---

## Step 2 — Prompt Formulation

Write one focused prompt that contains:
- The problem or question to analyze
- All relevant constraints and context
- The required output format (e.g. "structured recommendation with reasoning")

Keep it self-contained. The peer CLIs have no project context — everything they need must be in the prompt itself.

### Debate Problem-Framing Guard (hard requirement)

In `debate` mode, the Round 1 prompt must be framed around the user's need, constraints, and decision criteria before presenting any candidate solution.

Rules:

1. If the user has a preferred or likely solution, label it as one option, not as the proposed direction or expected answer.
2. State the underlying need in neutral terms: what must be achieved and why it matters.
3. Require peers to compare multiple viable designs, including at least one alternative that rejects or substantially changes the user's preferred option.
4. Require peers to surface failure modes, hidden costs, and conditions that would make each option wrong.
5. Do not use wording that implies the Coordinator has already selected the answer, such as "evaluate this excellent design", "confirm this approach", or "the desired direction is".
6. If the user explicitly asks to validate a specific proposal, still ask peers to provide the strongest case against it before giving a verdict.
7. If the packet cannot be made neutral because required context is itself a proposal, include a `Bias Risk` note in the packet and ask the user to approve that framing before dispatch.

#### Blind-Spot Probe (hard requirement)

The Round 1 prompt MUST require every peer to return a dedicated `Blind Spots` section naming:

- (a) any viable option the packet failed to list,
- (b) a question we should be asking but aren't (a reframe of the problem, not just a new answer to the stated questions),
- (c) the single assumption baked into the framing that is most likely to be wrong, and why.

This is distinct from the "something else" option and the failure-mode critique in rules 3-4: those probe for a missing *answer*; this probes for a missing *question* or framing error. Do not omit it because the option set looks complete — the point is to surface what the Coordinator did not think to ask. Carry these blind-spot responses into synthesis; a surfaced reframe or broken assumption that 2+ peers raise is a strong signal and must appear in the Decision Ledger or Unresolved Deltas.

Recommended Round 1 shape:

```text
Need: <what we need>
Constraints: <what must be preserved or avoided>
Options to evaluate: <candidate A, B, C, including "something else">
Adversarial task: identify the best design, reject weak options, and explain what evidence would change your answer.
Blind Spots (required): name (a) an option we did not list, (b) a question we should be asking but aren't, (c) the framing assumption most likely to be wrong.
```

### Shared Context Packet Protocol

Use a shared context packet when the question depends on brownfield repo knowledge, greenfield planning docs, or any project context too large or important to rely on an ad hoc prompt alone.

1. Before writing a packet to disk, decide whether it is `local-only` scratch or a retained project artifact.
2. If the user has not already specified that choice, ask:
   `Save context packet? Reply "save packet" to retain it in <ADS_MEMORY_ROOT>/reports/swarm-consensus/context/ or "local only" to keep it in <ADS_MEMORY_ROOT>/.local-artifacts/swarm-consensus/context/.`
3. Save the packet at `<ADS_MEMORY_ROOT>/.local-artifacts/swarm-consensus/context/CTX-<slug>-<YYYY-MM-DD>.md` by default.
4. If the user explicitly wants a reusable retained artifact, save or promote the packet to `<ADS_MEMORY_ROOT>/reports/swarm-consensus/context/CTX-<slug>-<YYYY-MM-DD>.md`.
5. Use `skills/swarm-consensus/references/context-packet-template.md` as the reference layout.
6. Put only the context every participant needs, subject to the standing-rule exception in `<AI_DEV_SHOP_ROOT>/skills/coordination/SKILL.md` (Dispatch Prompt Construction):
   - the exact question to answer
   - project type (`brownfield` or `greenfield`)
   - scope, goals, and constraints
   - architecture summary
   - relevant files and source artifacts
   - known unknowns and open decisions
7. Give the same packet content to every peer CLI. A self-contained `stdin` payload is the preferred transport **only for questions that are not repo-dependent**. When the question is about this codebase, the Repo Access Gate below overrides this step: the primary model must not inspect the repo directly while peers reason from prose.
8. If the question is materially repo-dependent and no shared packet exists yet, create one before dispatching peers.
9. If a peer still needs file-based packet access because the payload is too large or it must inspect repo files directly, follow the shared transport fallback rules in `skills/llm-operations/references/peer-llm-dispatch.md`.
10. Do not promote a local-only context packet into `<ADS_MEMORY_ROOT>/reports/` only to satisfy peer readability.

### Online Resource Pre-Fetch (primary model responsibility)

If the prompt requires online resources (URLs, external files, live data from the web):

1. **The primary model fetches all required resources before dispatching to peers.**
2. Embed fetched resource content into the shared prompt payload — do not pass raw URLs and expect peers to fetch independently.
3. If any required resource cannot be fetched (404, timeout, auth wall, etc.):
   - Do not proceed with a degraded prompt that omits the resource.
   - Tell the user immediately: which URL failed and why.
   - Ask whether to proceed without that resource or abort.
   - If the user says proceed, note the missing resource explicitly in the prompt so all models reason from the same incomplete-but-declared baseline.

**Rationale:** Some LLMs in the swarm may not have web access, or the same URL may return differently across models. Pre-fetching by the primary model guarantees all peers reason from identical source material.

### Source Material Gate (hard requirement, debate mode)

When a debate or consensus question originates from or explicitly references an external resource (article, paper, blog post, documentation page, or any URL the user shared as the basis for the discussion):

1. **The full text of that source material MUST be embedded in the peer dispatch packet.** A summary or paraphrase is not sufficient — peers need the same primary source the primary model reasoned from.
2. The primary model must attempt to fetch the resource before dispatch. Use web fetch, Wayback Machine, or any available retrieval method.
3. If the resource cannot be fetched (auth wall, paywall, rate limit, 403/429):
   - Tell the user: "I couldn't fetch [URL]. For a higher-quality debate, I need the full source text so all participants reason from identical material."
   - Ask the user to paste the article/paper content directly, or provide an accessible alternative URL.
   - Explain: "Having full context materially improves debate quality — without it, peers may hallucinate details or argue from incomplete understanding."
4. If the user cannot provide the text either:
   - Ask whether to proceed with whatever partial content was obtained (e.g., title, snippet, cached excerpt).
   - If proceeding, add a `## Source Material Limitation` section to the peer packet declaring exactly what was and was not available.
   - All participants must be told the source is incomplete so they can flag reasoning gaps.
5. Never dispatch a debate where the triggering source was available to the primary model but withheld from peers. That creates an asymmetric information advantage that undermines debate integrity.

**Rationale:** Debates triggered by external research lose most of their value when peers argue from summaries or partial context. The primary model has already read the source — peers deserve the same grounding to produce genuinely independent, well-informed positions.

### Repo Access Gate (hard requirement, debate mode)

The code equivalent of the Source Material Gate above. When a debate or consensus question is about
**this codebase** — its architecture, a proposed refactor, a migration, an interface, a build order,
or any "should we build X this way" question grounded in existing source:

1. **Every load-bearing claim about current state MUST appear in the packet as verbatim code with a
   `file:line` citation, not as prose.** A description of an interface is not the interface. If the
   debate will turn on what a type, signature, options bag, or call site actually looks like, quote
   it.
2. **Peers get repo file access by default, not packet-only.** External peer CLIs run locally and can
   read files. Do not treat packet-only as the default for a repo question:
   - `codex exec` — run from the repo with a read-only tool surface.
   - `agy` — cannot read outside its working directory and inherits any ancestor `AGENTS.md`; use the
     documented staging procedure in `skills/llm-operations/references/peer-llm-dispatch.md`
     ("File context is the default, staged, not denied") to copy the needed files into a clean
     staging base and reference the staged paths.
   - Grant **read-only**. A debate participant never needs write access.
3. **Name the repo, and every repo.** State explicitly which repository and package each cited file
   lives in, and whether any of them is a separately-published artifact. A question spanning two
   packages must say so in the packet — participants cannot price a package-boundary or public-API
   cost they were never told exists.
4. **Before dispatch, run a state-claim audit on the packet.** List every assertion the packet makes
   about how the code works today. For each one, confirm it is backed by a quoted call site rather
   than a doc comment or a summary. Comments in this codebase have been wrong repeatedly; a packet
   that launders a stale comment into four participants' reasoning is the failure this gate exists to
   prevent.
5. **If a peer cannot be given repo access**, say so explicitly in the packet under a
   `## Repo Access Limitation` heading naming which participants are packet-only, and compensate by
   quoting more code, not less. Then weight that participant's *current-state* claims lower in
   synthesis while still weighting its *design* reasoning normally.
6. **Never dispatch a repo debate where the primary model read the code and the peers did not.**
   Same rule as Source Material Gate step 5, same reason.
7. **In the report, separate "converged on a target design" from "converged on a claim about current
   state."** Participants agreeing on where to go is not evidence that they agreed on where things
   stand. Record which participants had repo access when logging any convergence count.

**Rationale (earned, 2026-09-02):** A 3-round, 5-participant debate on external-service integration
adopted "the adapter never holds a secret" as its #1 finding, converged 5-of-5, four of them blind. The real
code was the exact inverse — the host eagerly resolves every provider's plaintext key and hands the
engine a map (a `credentials` field on the engine's options type, a *published npm package's public API*). The
packet described the seam in prose and never named the repo the code lived in; the engine's options type
appeared in zero of four packets. The one participant with repo access flagged the inversion; the four
without it did not, and the finding shipped as "Adopt" with a refactor-sized cost estimate for what is
actually a public-API migration across a package boundary.

### Prompt Transport Safety (hard requirement)

Do not pass large or untrusted prompt text directly as shell-interpolated inline strings.

1. Write the full prompt to a temporary file (for example `.swarm-prompt.txt`) or pipe it via stdin.
2. Invoke peer CLIs using file/stdin-safe patterns where possible.
3. If a tool only supports inline prompt args, apply strict escaping and note this risk in the report.
4. Never execute fetched resource content as shell code.

For file-based transport, prefer `<ADS_MEMORY_ROOT>/.local-artifacts/swarm-consensus/prompts/` over the repo root.

### Peer Prompt Preview Gate (hard requirement)

Before sending any prompt, context packet, or dispatch file to external peer
LLMs, show the user the exact file that will be sent and wait for explicit
confirmation.

1. Write the final peer-facing prompt or context packet to disk first.
2. Show the user:
   - a short `Peer Dispatch Brief`
   - the file path for the exact prompt or packet
   - the full file content only when the user asks for it or when the packet is
     tiny enough to be clearer than a summary
3. Build the `Peer Dispatch Brief` from the required fields in
   `skills/llm-operations/references/peer-llm-dispatch.md`, which is the only
   place those fields are listed.
4. Ask the user to reply `run` before dispatching external peer CLIs.
5. If the user edits the intent or flags an issue, revise the file and repeat
   the preview gate.
6. In debate mode, the Round 1 peer prompt must not include the Primary model's
   answer. If later rebuttal rounds use a materially different prompt or include
   other participants' full previous-round reasoning, preview that rebuttal
   prompt before dispatch too.
7. Do not treat the model-resolution confirmation gate as a substitute for this
   preview. The user must be able to inspect the actual words sent to other LLMs
   through the linked packet without having to read the full packet inline.

---

## Step 3 — Swarm Dispatch

**CRITICAL ANTI-HALLUCINATION RULE:** You MUST NOT fake, imagine, or hallucinate the responses from other models. If a CLI tool is not installed, or if the shell command fails or times out, you must strictly report that it failed or is unavailable. Do not invent a consensus or make up quotes from peer models. You are only allowed to synthesize the actual text captured from the `stdout` of the shell commands.

### First-pass anti-bias rule (hard requirement)

1. Primary model MUST produce its own answer first and freeze it.
2. Primary model MUST NOT read peer outputs until its first-pass answer is written.
3. Round-1 peer prompts MUST NOT include other models' answers.
4. If the host environment cannot surface the primary model's first-pass answer cleanly, it MUST create one same-family child/helper to fill the `Primary` slot before peer synthesis.
5. Peer-only consensus runs are invalid and MUST stop.

### Swarm timeout budget (hard requirement)

1. Before starting the swarm timer, run the Peer Handshake Gate from `<AI_DEV_SHOP_ROOT>/skills/llm-operations/references/peer-llm-dispatch.md` for every external peer in the round.
2. Require packet-bound ACK within 60 seconds by default: `ACK_PACKET_RECEIVED <packet-id or deterministic packet marker> -- I received the packet and will work on it.`
3. Start the wall-clock swarm timer only after required peer handshakes succeed or are explicitly classified and excluded.
4. Default to `swarm_timeout_seconds=300` unless the user overrides it.
5. Before every peer CLI call in any round, compute the remaining swarm budget.
6. Use that remaining budget as the maximum wait for the next peer call.
7. If the remaining budget is `<= 0`, stop dispatching additional peer calls, mark unfinished peers as timed out, and continue with synthesis from the responses already captured.

### Structured Output And Diagnostics Protocol

1. Prefer structured output modes such as JSON when a peer CLI supports them.
2. Parse the peer answer from `stdout` only.
3. Treat `stderr` as diagnostics, not as part of the peer answer.
4. If a CLI emits startup chatter, tool logs, or repo bootstrap text, exclude that material from the peer answer. Use only the structured payload or the end-marker-delimited answer.
5. If structured mode fails but plain text succeeds, record the fallback mode and include that fact in the report.

Store raw per-round stdout/stderr captures in `<ADS_MEMORY_ROOT>/.local-artifacts/swarm-consensus/offloads/` by default. Only save them under `<ADS_MEMORY_ROOT>/reports/offloads/` when the user explicitly wants retained evidence.

### Retryable Peer Failure Protocol

1. Treat transient transport/capacity failures as retryable when the signal is clearly temporary (for example HTTP `429`, HTTP `503`, rate-limit text, or provider capacity exhaustion text).
2. Retry with bounded backoff only while there is remaining `swarm_timeout_seconds` budget.
3. Stop after at most 2 retries per peer call.
4. If retries are exhausted, mark the peer as failed and record the attempt count plus the last error class in the report.

### Anti-Truncation Protocol (hard requirement)

Do not rely on subjective "looks abrupt" checks alone.

1. Require each peer response to end with a deterministic end marker, for example `<<SWARM_END>>`.
2. If marker is missing, or response is empty/obviously partial, mark it as `Failed (Truncated)`.
3. **Truncated responses MUST NOT be included in synthesis.**
4. Tell the user inline: `[ModelName]'s response was truncated or incomplete. It has been excluded from synthesis.`

### Round 1 (all modes)

1. **Self (primary model):** Generate full first-pass response and freeze it.
2. **Each available peer CLI:** Execute via shell, capture `stdout`. Use the remaining `swarm_timeout_seconds` budget for each call — if a tool hangs or the budget is exhausted, mark it as timed out and continue.

```bash
# Example patterns — adapt to actual CLI support
# Prefer structured output and keep stderr separate from the peer answer
claude --output-format json -p "$(cat .swarm-prompt.txt)" 2>peer-claude.stderr
script -q /dev/null agy --model "Gemini 3.1 Pro (High)" --dangerously-skip-permissions --print "$(printf '<<PEER_DISPATCH>>\n\n'; cat "$(pwd)/.swarm-prompt.txt")" > peer-agy.raw 2>&1  # cwd=/tmp; `script` pty defeats agy's non-TTY hang; then strip ANSI: perl -pe 's/\e\[[0-9;?]*[a-zA-Z]//g; s/\r//g' peer-agy.raw > peer-agy.txt
{ printf '<<PEER_DISPATCH>>\n\n'; cat .swarm-prompt.txt; } | codex exec --ignore-rules --ephemeral --json -m <resolved-model> -C <repo> - >peer-codex.jsonl 2>peer-codex.stderr
```

If a peer CLI returns a non-zero exit code or empty output, mark it as failed in the report and exclude it from synthesis.
For Codex, use `skills/llm-operations/references/codex-dispatch.md` instead of improvising retry flags. If Codex exits `133`/`SIGTRAP`, follow that file's version-quarantine and withdrawal rules.

### Resource Fetch Failure — Peer Withdrawal Protocol

If a peer model's response contains a resource fetch failure signal (e.g. it reports it could not access a required URL, file, or external dependency needed to answer the question):

1. **Mark that peer as "Resource unavailable" in the Swarm table** — do not include its response in synthesis.
2. **Tell the user immediately**, inline, before continuing:
   > `[ModelName] could not access [resource]. It has withdrawn from this round. Continuing with [remaining models].`
3. Do not silently include a response that was built on assumptions about content the model could not read — that contaminates synthesis with hallucinated context.
4. If the *primary model* cannot fetch a required resource, it must tell the user and stop the run (or ask to proceed without it) — it cannot dispatch a degraded prompt to peers without disclosing this.
5. If after withdrawals only one model remains (primary + 0 peers), stop and inform the user: not enough participants for meaningful consensus.

---

### Debate rounds (debate mode only)

In `debate` mode, run bounded rebuttal rounds after Round 1:

1. Build a decision-point ledger (architecture choice, data model strategy, risk posture, migration approach, etc.).
2. **Self (primary model) rebuttal — mandatory, every round:** Before or alongside building the peer rebuttal packet, the Primary model MUST produce its own fresh rebuttal for this round. Read every participant's full previous-round response (peers + your own prior round), then independently write your current position for each disputed decision point, why you hold it, whether it changed this round and why, the strongest argument against the leading opposing position, and what would change your mind. Freeze this before reading any peer's *this-round* response — do not let a peer's round-N answer bias the Primary's round-N position, mirroring the Round 1 anti-bias rule. The Primary is a full debate participant in every round, not just Round 1: a round where the Primary silently relays or synthesizes without stating and updating its own reasoned position is invalid and must be redone.
   - The Primary's frozen Round 1 answer is never simply carried forward unchanged into later rounds' Decision Ledger entries — each round's Primary row reflects that round's actual rebuttal, even when the conclusion is "unchanged" (state that explicitly, with why).
3. Build the rebuttal packet from full reasoning, not summaries: include every participant's complete previous-round response verbatim (Primary + every peer), plus the decision-point ledger for structure. Full reasoning is the default. Only condense a single response when its length is disproportionately large next to the others (rare — expect this under 1% of rounds in practice), and even then keep it lossless on substance (no dropped arguments or evidence), trimming only redundancy/filler.
   - For each disputed decision point, require every responding model — Primary and peers alike — to state:
     - its current position
     - why it currently holds that position
     - the strongest reason against the leading opposing position
     - whether its position changed this round and, if so, why
     - what evidence, assumption change, or repo fact would change its mind
   - Do not accept a bare "still agree/disagree" rebuttal when the model can provide reasoning. The point of the debate round is rationale movement, not just vote counting. This applies to the Primary exactly as it applies to peers.
   - **Mid-Debate Dropout Rule:** If a model that participated in Round 1 fails to respond, times out, or reports a resource failure in Round 2+, it **withdraws from the remainder of the debate**. 
   - Do not hallucinate its rebuttal. Note its withdrawal inline to the user. Its Round 1 positions remain in the ledger but are marked as "Final (Withdrawn)".
   - The same `swarm_timeout_seconds` budget applies to debate rounds. If the remaining budget expires mid-debate, stop additional rebuttal calls, mark affected peers as `Withdrawn`, and synthesize with the evidence already collected.
   - Recompute active participants each round. If active participants drop below two total responders (primary + at least one peer), stop debate and report insufficient participants for meaningful consensus.
4. Repeat for up to `max_rounds`.
5. Stop early when agreement is >=`min_confidence` on decision points.

Agreement formula:
- `agreement_percent = (decision_points_with_same_outcome / total_decision_points) * 100`

If max rounds reached without reaching `min_confidence`:
- stop debate,
- declare unresolved deltas,
- provide recommendation with explicit uncertainty/tradeoff callouts.

---

## Step 4 — Synthesis

With all responses collected:

1. **Areas of agreement** — where 2+ models reached the same conclusion independently. These are strong signals. Weight them heavily.
2. **Areas of divergence** — where models disagreed. Do not average them out. Explain *why* they diverged (different assumptions, different risk weighting, different information). Present both positions clearly.
3. **Unique insights** — something only one model raised. Flag it as unverified but worth considering.
4. **Final recommendation** — your synthesized conclusion. Be explicit about which inputs drove it and why.

---

## Step 5 — Output

### Template Guard (hard requirement)

1. The final report MUST use the Step 5 headings and tables in the order shown below.
2. Do not collapse a consensus run into a prose-only summary when the user asked for a report or when writing an artifact.
3. In `debate` mode, you may add a `## Debate Trace` section for round-by-round movement, but you must still include all mandatory sections from the template.
4. Before writing any report to disk, decide whether it is `local-only`, `retained`, or `inline-only`.
5. If the user has not already specified that choice, ask:
   `Save consensus report? Reply "save report" to retain it in <ADS_MEMORY_ROOT>/reports/swarm-consensus/runs/, "local only" to keep it in <ADS_MEMORY_ROOT>/.local-artifacts/swarm-consensus/runs/, or "inline only" for no file.`
6. By default, write ad hoc run reports to `<ADS_MEMORY_ROOT>/.local-artifacts/swarm-consensus/runs/<timestamp>-consensus-report.md`.
7. If the user explicitly wants a retained architecture or project artifact, write the final report to `<ADS_MEMORY_ROOT>/reports/swarm-consensus/runs/<timestamp>-consensus-report.md` instead.
8. If a shared context packet was used, record its path in the report header.
9. If the user prefers inline output instead of a file, preserve the same section order and tables inline.
10. A valid report MUST include a non-empty `Primary` row in `## The Swarm`.
11. A valid report MUST include a non-empty `### <Primary model name>` subsection under `## Individual Responses`.
12. If either primary slot is missing or empty, stop and report the run as invalid rather than presenting peer-only output as consensus.

Produce a `consensus-report.md` (or inline if the user prefers) with this structure:

```markdown
# Consensus Report

**Date:** <ISO-8601>
**Prompt:** <the prompt used>
**Context Packet:** <path or "none">
**Mode:** <single-pass | debate>
**Controls:** `max_rounds=<int>`, `min_confidence=<0.0-1.0>`, `swarm_timeout_seconds=<int>`, optional per-run model overrides
**Primary model:** <name>

## The Swarm
| Role | CLI | Requested Model | Resolved Model | CLI Version | Selection Source | Status | Attempts |
|---|---|---|---|---|---|---|---|
| Primary | <your CLI> | <requested> | <resolved> | <version> | <source> | Responded | 1 |
| Peer | claude | <requested or "n/a"> | <resolved or "unknown"> | <version or "not installed"> | <source> | Responded / Failed / Failed (Truncated) / Timed out / Retry exhausted / Withdrawn / Not installed / Resource unavailable | <count> |
| Peer | agy    | <requested or "n/a"> | <resolved or "unknown"> | <version or "not installed"> | <source> | Responded / Failed / Failed (Truncated) / Timed out / Retry exhausted / Withdrawn / Not installed / Resource unavailable | <count> |
| Peer | codex  | <requested or "n/a"> | <resolved or "unknown"> | <version or "not installed"> | <source> | Responded / Failed / Failed (Truncated) / Timed out / Retry exhausted / Withdrawn / Not installed / Resource unavailable | <count> |

## Dispatch Diagnostics
| CLI | Output Mode | stdout Parser | stderr Summary | Retry Notes |
|---|---|---|---|---|
| claude | json | result field / end marker | <short summary> | <attempt summary> |
| agy    | text | full stdout stripped / end marker | <short summary> | <attempt summary> |
| codex  | json | event stream / agent message | <short summary> | <attempt summary> |

## Debate Trace
<Only include in debate mode. Capture round-by-round deltas, rationale changes, withdrawals, and position shifts before synthesis. For each disputed decision point, record each model's current position — including the Primary's — why it held that position that round, whether it changed, and what would change its mind. The Primary must have its own row/entry every round; it is a participant, not just the synthesizer.>

## Individual Responses

Use the resolved model identity (e.g., "Claude Opus 4.6", "Gemini 3.1 Pro", "Codex GPT-5.5 xhigh") as the heading — not the CLI name alone.

### <Primary: resolved model identity>
<Summary of primary reasoning. In debate mode, this must reflect the Primary's own position across all rounds, not just its frozen Round 1 answer — note explicitly where it held firm vs. changed and why.>

### <Peer 1: resolved model identity> (if responded)
<Summary of peer response>

### <Peer 2: resolved model identity> (if responded)
<Summary of peer response>

## Synthesis

### Agreement
<What all responding models agreed on>

### Divergence
<Where they disagreed and why>

### Unique Insights
<Anything only one model raised>

### Decision Ledger

Use resolved model identities as column headers (e.g., "Claude Opus 4.6", "Gemini 3.1 Pro", "Codex GPT-5.5 xhigh").

| Decision Point | <Primary model> | <Peer 1 model> | <Peer 2 model> | Agreement | Key Why / Movement |
|---|---|---|---|---|---|
| <point 1> | <position> | <position> | <position> | Yes/No | <main rationale and any round-to-round movement> |

### Unresolved Deltas
<Only include if disagreement remains after synthesis/debate>

## Final Recommendation
<Synthesized conclusion with reasoning>
```

Always fill in the Swarm table completely, including models that were not installed or failed. The user should always know which models contributed, which models were only inferred, and how many attempts each peer required.

---

## Configuration

If the user asks to set a default model version for a peer CLI (e.g. "always use Opus for Claude in consensus runs"), save that preference and apply it as a flag on future dispatches. Document what flag was used in the consensus report so the run is reproducible.

Even when a saved preference exists, if the current run did not explicitly pin the model, preflight must still show the planned model and give the user a chance to override it before dispatch.
