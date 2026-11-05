# Peer LLM Dispatch

Use this reference when one LLM is asking another LLM CLI to review, debate, or validate work.

## Structural Gap Scan (Mandatory Pre-Packet Gate)

Before constructing the shared context packet, the Coordinator must scan the user's input material (prompt, doc, spec, or proposal) for load-bearing structural gaps — entire concerns or architectural dimensions that are absent, not merely under-detailed.

**This gate is about missing floors, not missing furniture.** Do not flag cosmetic, editorial, or minor omissions. Only flag gaps where the absence would cause peers to reason from a materially incomplete picture or produce recommendations that silently ignore a critical dimension.

**Trigger:** This gate fires when the input material describes a system, architecture, pipeline, workflow, or proposal that peers will reason about. It does NOT fire for narrow code-level questions, single-file reviews, or mechanical tasks.

**What to scan for:**

1. **Missing operational concerns** — Does the input cover how the system fails, recovers, rolls back, and scales? If it only describes the happy path, that's a structural gap.
2. **Missing lifecycle stages** — Does it cover build, deploy, run, monitor, and decommission? If entire lifecycle stages are absent, flag them.
3. **Missing cross-cutting concerns** — Security, observability, cost, compliance, data governance, disaster recovery, capacity planning. If any of these are load-bearing for the described system and entirely absent, flag them.
4. **Missing failure modes** — Does it describe what happens when components fail, third parties are unavailable, or traffic spikes? If the system has external dependencies and no failure handling is described, flag it.
5. **Missing boundaries/interfaces** — Does it define what's inside vs outside scope? If the system interacts with other systems and those interfaces are unspecified, flag them.
6. **Missing sequencing/phasing** — If the proposal is ambitious, does it describe how to get there incrementally? If it's all-or-nothing with no rollout strategy, flag it.

**How to apply:**

1. Read the input material in full.
2. Identify which category the material falls into (system design, pipeline, architecture, workflow, proposal).
3. Based on that category, check whether each relevant structural dimension is present, absent, or explicitly deferred.
4. For each gap found: state the missing dimension in one line and why its absence is load-bearing (what goes wrong if peers don't consider it).
5. Present the gaps to the user before packet construction. Ask: "Should I add these to the packet for peers to address, or are any intentionally out of scope?"
6. Incorporate confirmed gaps into the context packet as explicit open questions for peers, with an instruction that peers are expected to surface additional structural gaps the Coordinator may have missed.

**What this gate does NOT do:**

- Does not block dispatch indefinitely — if the user says "send it as-is," proceed.
- Does not flag gaps that are already explicitly marked as "out of scope" or "deferred" in the input.
- Does not flag vendor-specific gaps (e.g., "you didn't mention which CDN") — only role-level gaps (e.g., "there's no caching layer described at all").
- Does not generate the fixes itself — it identifies what's missing and asks the user whether to include it.
- Does not apply to narrow/mechanical tasks where the input is already bounded.

**Escalation:** If the scan reveals 2+ structural gaps, tell the user the input material may need a revision pass before dispatch to avoid sending peers an incomplete foundation. Recommend but do not require.

---

## Unlisted Option Prompt (Mandatory)

When the peer-facing prompt presents named options, candidates, or proposed shifts for the peer to evaluate, always include one additional open-ended option that asks the peer to surface a strong alternative not listed.

**Rule:** Every prompt that presents options A/B/C/D or a numbered list of proposals must end with a variant of:

> "Is there a strong option, shift, or decomposition not listed above that you believe is better or that the framing has missed? If yes, describe it and explain why it's stronger than the presented options."

**Why:** The Coordinator's option set is bounded by its own reasoning. Peers with different priors or domain knowledge may see a framing the Coordinator missed entirely. Without this prompt, peers anchor on the listed options and never surface the unlisted one — even if it's stronger.

**What this does NOT do:**
- Does not require the peer to invent something if the listed options are comprehensive — "No, the listed options cover it" is a valid response.
- Does not dilute the peer's main argument — place this prompt after the adversarial task, not before it.

---

## Default Pattern

- Follow `<AI_DEV_SHOP_ROOT>/skills/coordination/SKILL.md` (Dispatch Prompt Construction) for task scope and the standing-rule block.
- Build a shared packet first.
- Make the packet packet-first and work-log-first.
- Treat raw diffs, commits, or logs as supporting evidence, not the default payload.
- Prefer delivering a self-contained packet via `stdin` when the peer does not need repo file reads and the payload fits cleanly in one bounded request.
- Use file-based dispatch only when the peer must inspect repo files directly or the packet would become too large or brittle to inline safely.

For most toolkit-maintenance work, the packet should lead with:

1. what changed
2. why it changed
3. exact files touched
4. what was verified
5. what was not verified
6. out-of-scope local changes
7. the exact question for the external LLM

Use commit or diff references only when they materially help the auditor inspect details.

## Solution Slate Protocol (output requirement, not transport)

For any actionable fix, audit finding, or issue resolution, both the peer-facing prompt and the Coordinator's synthesis must produce a **ranked slate of solutions**, never a single take-it-or-leave-it answer. Applies to `/debate` (synthesis / Round 2+ only), `/audit-work`, `/cowork`, and `/consensus` single-pass. Require this in the peer prompt, and reconcile the peers' slates into one Coordinator slate.

Every slate must contain:

1. **≥2 candidate solutions.** If only one is genuinely viable, still name the rejected alternatives and state why they were pruned — the slate exists, just pre-pruned.
2. **Explicit ranking criteria.** State the criteria used (e.g. correctness, blast radius, reversibility, cost, effort) before ranking, so the order is auditable rather than asserted.
3. **Full reasoning per option** — trade-offs, failure modes, and a genuine sacrifice. No all-upside option; if an option looks free, the cost is being hidden.
4. **A recommendation** — the top pick plus the cheapest test or smallest reversible step that would de-risk or falsify it.
5. **Command-specific artifact for the leading option(s):**
   - `/debate` — back the leading option with **sample code or pseudocode**, not prose alone.
   - `/audit-work` — a concrete diff-level proposed fix per option, which then feeds the existing Proposed-Fix Disposition Gate.
   - `/cowork` — ranked correction plans presented before any correction is applied.
   - `/consensus` single-pass — the ranked slate + recommendation in the synthesis section.

**Scope guard:** this does NOT apply to `/debate` Round 1, which stays solution-neutral (see the Debate Problem-Framing and Round-Disclosure guards). It activates only at synthesis / Round 2+, once independent positions exist.

## Heavier Repo Workloads

Treat this as guidance, not a hard constraint:

- Prefer packet-first prompts plus an explicit file list before escalating to open-ended repo exploration.
- If a peer stalls, returns empty output, or behaves inconsistently on a broad repo-audit prompt, retry once with the same packet and a bounded file set.
- If the packet already names the relevant files, prefer a bounded prompt and a constrained read-only tool surface over a broad open-ended repo-audit prompt.
- Do not assume a failure on an open-ended repo audit means the peer cannot handle repo work in general; first test whether the bounded version succeeds.

## Session Reuse

Some peer CLIs perform expensive startup work (reading project docs, running bootstrap sequences) on the first turn. To avoid paying this cost repeatedly within a single workflow (e.g., a `/cowork` run with diagnosis → verification → correction phases), reuse the same peer session across phases.

### Codex Peer Dispatch

Use `skills/llm-operations/references/codex-dispatch.md` for Codex-specific
transport, peer-marker, version-quarantine, and crash-handling rules. Keep this
shared peer-dispatch file focused on cross-CLI behavior.

#### Multi-phase dispatch (for `/cowork` with diagnosis → correction)

For Codex multi-phase session reuse, use the canonical patterns in
`skills/llm-operations/references/codex-dispatch.md`.

Session reuse remains scoped to one workflow run. Do not reuse Codex sessions
across different `/cowork`, `/consensus`, or `/audit-work` runs.

### agy (Gemini via agy CLI) Session Reuse

The `gemini` CLI has been sunsetted for the individual tier. Use `agy` as the Gemini peer instead.

**Key dispatch rules for `agy`:**

- **Always run from a directory with no `AGENTS.md` in the working directory or any ancestor.** `agy` has no `--ignore-rules` flag and discovers `AGENTS.md` by walking ancestor directories, so any working dir still *inside* the repo tree can inherit the repo's root `AGENTS.md` and pollute the peer's context with Coordinator startup noise. "Outside the repo" is not sufficient by itself in a single-folder install where `<ADS_MEMORY_ROOT>` lives inside the repo tree.
- **File context is the default, staged, not denied.** Running clean must not starve Gemini of the files it needs — that under-contexts deep work. Because `agy` can only read files inside its own working directory, stage the necessary repo files for it: copy the files the peer needs into the staging base's `files/` subdir (preserving relative paths), run `agy` from the staging base, and reference the staged paths in the packet so Gemini reads real file content with its file tools — without inheriting the repo's `AGENTS.md`. Choose the staging base by install topology:
  - **Subfolder install** (`<ADS_MEMORY_ROOT>` is a sibling OUTSIDE the repo tree): use `<ADS_MEMORY_ROOT>/tmp/peer-dispatch/<workflow>/`.
  - **Single-folder install** (`<ADS_MEMORY_ROOT>` lives INSIDE the repo tree, e.g. `AI-Dev-Shop/ADS-memory/`, and a root `AGENTS.md` exists): staging under `<ADS_MEMORY_ROOT>/tmp/...` is still inside the repo tree and does NOT escape ancestor-walk discovery — use a genuinely external base instead, e.g. `${TMPDIR:-/tmp}/ads-peer-dispatch/<workflow>/`.
  - Either way, verify no `AGENTS.md` resolves from the chosen base before dispatch. Reference ONLY the staged paths in the packet, never the original repo paths — `agy` cannot read outside its working dir, so an original-repo path is an unreadable dangling reference. Prefer a bounded, named file set over copying the whole tree. Only fall back to a fully self-contained inline packet (no staged files) when the peer genuinely needs no file reads or the set is too large to stage cleanly.
- **Model flag:** `--model "Gemini 3.1 Pro (High)"` (use the exact string from `agy models`). The default peer model is `Gemini 3.1 Pro (High)`.
- **Output mode:** `agy` returns plain text via `--print`. There is no `--output-format json` equivalent. Use the full stdout (stripped) as the peer answer — do not truncate to last line.
- **Transport observability:** Tier 2 (deferred/buffered). Use probe-then-dispatch pattern.
- **No session reuse** currently available in headless `--print` mode.

**Single-shot dispatch pattern:**

```bash
cd /tmp && agy --model "Gemini 3.1 Pro (High)" --print "$(cat /path/to/prompt.txt)"
```

**What the `agy` preamble looks like:** When run from inside the repo, `agy` boots the Coordinator and prints startup info before the answer. Running from `/tmp` suppresses this entirely — output is the raw model response only.

**Available models (from `agy models`):**
- `Gemini 3.8 Flash (Low/Medium/High)` ← newest, released 2026-09-02
- `Gemini 3.7 Flash (Low/Medium/High)`
- `Gemini 3.6 Flash (Low/Medium/High)`
- `Gemini 3.1 Pro (Low/High)` ← default peer
- `Claude Sonnet 4.6 (Thinking)`, `Claude Opus 4.6 (Thinking)` (same-family, exclude when primary is Claude)
- `GPT-OSS 120B (Medium)`

### Gemini Session Reuse (legacy — gemini CLI sunsetted)

The original `gemini` CLI (`gemini -p`) is no longer available on the individual tier (`IneligibleTierError`). Use `agy` above.

### Claude CLI Session Reuse

Claude Code CLI sessions are managed by the host process. When Claude is the primary (not a peer), session continuity is automatic. When Claude is dispatched as a peer via `claude -p`, each invocation is stateless — reuse is not currently supported in headless mode.

## Transport Rules

- Prefer structured output modes when the peer CLI supports them.
- Parse `stdout` only as the peer answer.
- Treat `stderr` as diagnostics and save it separately.
- Keep raw offloads in local scratch by default unless the user explicitly wants retained evidence.
- Do not treat zero-byte redirected offload files from an in-flight peer process as a failure signal by themselves. Some peers, including Claude Code in this repo's packet-audit pattern, may buffer output until process exit.
- Prefer `stdin` or another self-contained prompt transport before asking the peer to read a packet from disk.
- If the peer must read a packet from disk, make sure the packet lives in a peer-readable location.
- Prefer a short prompt that points the peer at the packet path over inlining the full packet body into a shell argument when a peer-readable file is available.
- When invoking peer CLIs from shell, avoid nested heredocs, large command substitutions, or other brittle quoting patterns for long prompts. Prefer a small stable prompt string or a prompt file.
- If a host-sensitive peer flow has a dedicated local runner script, prefer that script over rebuilding the shell wrapper ad hoc each time.
- If the peer is Claude Code CLI, also use `<AI_DEV_SHOP_ROOT>/skills/llm-operations/references/claude-code-cli-audits.md` for host-specific transport quirks, timing behavior, and runner guidance.
- The dispatch-copy pattern is intended to be cross-platform, but it is not yet verified on native Windows shells in this repo. Current shell examples assume a Bash-compatible environment.

## Peer Dispatch Brief

Before asking the user to approve a peer dispatch, show a compact brief rather
than dumping the full packet inline by default. The packet file remains the
exact source of truth and must be linked or named so the user can inspect it.

This is the only place the brief's required fields are written. Commands and
skills that show a brief defer here rather than listing the fields again.

The brief must include:

1. **Planned peers** — the peer models, named under the `Model Identity
   Disclosure Guard` in `<AI_DEV_SHOP_ROOT>/skills/swarm-consensus/SKILL.md`.
2. **Current positions** — one short line per participant when prior peer
   positions exist.
3. **Reasoning summary** — the strongest 2-4 reasons, disagreements, or risks.
4. **Next ask** — the exact question this dispatch asks the peers to answer.
5. **Run meaning** — what replying `run` will execute.
6. **File context (mandatory)** — state plainly that peers will read repo files
   for more context and better results, and name the bounded file set or staged
   path being made available. Reading necessary files is the default; if a run is
   deliberately packet-only, say so and why. For Gemini/`agy`, name the staged
   `<ADS_MEMORY_ROOT>/tmp/peer-dispatch/<workflow>/files/` set per the
   peer-dispatch rules above.

For debate rebuttal rounds, the brief must make the next-round ask explicit:
what positions are being challenged, which disagreements matter, and what
evidence or assumption change the peers should address. Do not require the user
to read a long terminal-rendered prompt to understand why the next dispatch is
happening.

### Reporting Peer Results to the User

When reporting results, synthesis, decision ledgers, or any peer output back to
the user, identify each participant by **model family + version + reasoning
mode** — not by CLI name or generic family alone.

Correct examples:
- `Gemini 3.1 Pro` (not "Gemini" or "gemini-cli")
- `Codex GPT-5.5 xhigh` (not "Codex" or "codex-cli")
- `Claude Opus 4.6` (not "Claude" or "claude-cli")

If the peer session reports its own identity (e.g., Codex session header shows
`model: gpt-5.5`), use that. If reasoning effort is known (e.g., `xhigh`,
`high`), include it. The user must always know exactly which model and tier
produced which output.

### Peer-Readable Packet Locations

This section is the source of truth for the temporary dispatch fallback location. Do not duplicate the exact fallback path across workflow docs unless a tool-specific runner requires it.

Do not assume every peer CLI can read every local path.

- Ignored repo paths such as `<ADS_MEMORY_ROOT>/.local-artifacts/` may be invisible to some tool layers.
- Generic OS temp paths such as `/tmp` may be outside the peer's allowed workspace.
- Default pattern:
  - write the authoring packet to `<ADS_MEMORY_ROOT>/.local-artifacts/`
  - if the peer can be served with a self-contained `stdin` payload, use that instead of any file path
  - if the peer can read the authoring path and still needs file-based transport, use it directly
  - if the peer cannot read it because the path is ignored, unreadable, or out of workspace, tell the user briefly and create a temporary peer-readable dispatch copy under `<ADS_MEMORY_ROOT>/tmp/peer-dispatch/<workflow>/`
  - give the peer the dispatch copy path, not the authoring path
- If needed, create a dispatch copy inside:
  - `<ADS_MEMORY_ROOT>/tmp/peer-dispatch/<workflow>/` inside the workspace root for local-only runs, or
  - `<AI_DEV_SHOP_ROOT>/tmp/peer-dispatch/<workflow>/` when the toolkit is a subfolder install and `<ADS_MEMORY_ROOT>` is a sibling path outside the peer CLI's allowed workspace,
  - a retained `<ADS_MEMORY_ROOT>/reports/...` path only when the user explicitly wants a repo-kept artifact or the workflow itself is already being retained
- Do not put the dispatch copy under a gitignored or tool-ignored path if the peer needs to read it with file tools.
- Do not promote a local-only packet into `<ADS_MEMORY_ROOT>/reports/` just to satisfy peer readability. Use the workspace `tmp/` fallback first.

If the packet is copied for dispatch, record both:

- `authoring packet`: where the coordinator wrote it
- `dispatch packet`: the peer-readable path actually given to the external LLM

### Readability Probe

Before the full peer review or debate call, run a cheap readability probe against the dispatch packet.

- Ask the peer to read the dispatch packet and echo the first Markdown heading or another small deterministic string from it using an explicit ACK form, such as:
  `ACK_PACKET_RECEIVED <packet-id or deterministic packet marker> -- I received the packet and will work on it.`
- If that probe fails because the path is ignored, unreadable, or out of workspace, classify it as `path_or_permission_failure`.
- Tell the user briefly which path failed.
- Fix the dispatch path, prefer `<ADS_MEMORY_ROOT>/tmp/peer-dispatch/<workflow>/`, and retry once before spending tokens on the real task.
- Do not treat a failed readability probe as model disagreement or reasoning failure.

### Transport Observability Classification

Before attempting the handshake, classify the transport's observability tier. This determines which handshake strategy is physically possible.

**Tier 1 — Streaming-observable:**
The peer CLI streams output in real-time. ACK text is visible as soon as the peer emits it. Full handshake protocol applies as-is with the 60-second ACK window.

- Gemini CLI (`gemini -p`): streams by default.
- Any peer with `--stream` or equivalent live-output mode.

**Tier 2 — Deferred-observable:**
The peer CLI buffers ALL stdout until process exit. ACK exists in the output but cannot be observed within the 60-second window during a long task. Use the **probe-then-dispatch** two-call pattern:

1. **Probe call** — ACK-only prompt, trivial workload, short timeout (60s). The prompt asks only for `ACK_PACKET_RECEIVED <marker>` and nothing else. Because the prompt is tiny, the peer exits quickly and the buffered ACK becomes visible.
2. **Dispatch call** — full task prompt, sent only after the probe returns a valid ACK. The full workflow timeout starts here.

This separates "can the peer receive my packet and respond" from "can the peer do the substantive work" into two calls, making the handshake verifiable even through a buffered transport.

- Codex CLI (`codex exec`): buffers all stdout until exit.
- Claude CLI (`claude -p`): may buffer until exit in headless mode.

**Tier 3 — Unobservable:**
The transport provides no structured output, no streaming, and no reliable way to confirm the peer received or processed anything. Examples: a CLI that writes only to an external log, a fire-and-forget webhook, or a broken pipe where stdout is lost.

- **STOP.** Do not proceed with dispatch.
- Tell the user: what transport was attempted, why it's unobservable, and that proceeding would risk silent failure with no way to detect or recover.
- Ask the user what to do. Possible options to present:
  1. Switch to a different transport mode for this peer (if one exists).
  2. Use a different peer that supports an observable transport.
  3. Proceed degraded with explicit acknowledgment that failure will be silent.
- Do NOT silently skip the handshake. Do NOT optimistically assume the peer will respond. Do NOT proceed and hope for the best. Silent failure is the worst outcome — it wastes time, tokens, and the user's trust.
- If the user chooses option 3 (proceed degraded), log it explicitly in the run output so future readers know the handshake was intentionally skipped and why.

**Classification rule:** If you cannot physically observe the peer's ACK within the ACK window while the peer is still working on the full task, the transport is NOT Tier 1. If the peer's output is completely unavailable by any means (not even after exit), it's Tier 3. Everything else is Tier 2.

### Peer Handshake Gate

Before starting the full peer-task timer for any long peer dispatch, run a cheap packet-bound handshake and show the result to the user. Apply the handshake strategy matching the transport's observability tier (see above).

- The handshake must prove the peer received the actual packet or prompt marker, not merely a generic request.
- For file-based packets, the readability probe is the handshake. Require the peer to return `ACK_PACKET_RECEIVED <packet-id or deterministic packet marker> -- I received the packet and will work on it.` before the full task starts.
- For self-contained `stdin` or inline prompt transport, include a packet ID or first-heading marker in the payload and require the same `ACK_PACKET_RECEIVED ...` form with no substantive reasoning.
- Use a 60-second ACK window by default unless the user overrides it.
- Start the full `cowork_timeout_seconds`, `swarm_timeout_seconds`, or audit timer only after the handshake succeeds.
- If the handshake fails, returns empty output, or times out, classify it as `handshake_failed` or the more specific transport failure (`path_or_permission_failure`, `malformed_or_no_output`, capacity error) and fix transport before spending the full task budget.
- The handshake is transport evidence only. Do not synthesize it as a peer answer.
- Adaptive escalation order (informed by Transport Observability Classification):
  1. Classify the transport tier first. If Tier 3 (unobservable), STOP and escalate to user immediately.
  2. For Tier 1 (streaming): try the easiest supported packet-bound ACK transport. Observe ACK in real-time within the 60-second window.
  3. For Tier 2 (deferred/buffered): use the probe-then-dispatch two-call pattern. Send a lightweight ACK-only prompt first with a 60-second timeout. Only dispatch the full task after the probe returns a valid ACK.
  4. If the probe or streaming ACK fails, fix the packet location or prompt transport and retry once using another supported method such as stdin, file path, in-repo dispatch copy, prompt file, session resume, or a CLI/provider-specific attachment mechanism.
  5. If the peer CLI supports streaming output but was invoked in buffered mode, switch to streaming mode so ACK text can be observed as soon as the peer starts emitting tokens (promotes from Tier 2 to Tier 1).
  6. If context retention matters AND transport is Tier 1, use a same-run ACK + task invocation: the peer reads the packet marker, emits `ACK_PACKET_RECEIVED ...`, then continues the substantive task in that same run. Do NOT use same-run ACK on Tier 2 transports — the ACK is unobservable until exit, defeating its purpose.
  7. If all supported transports fail, mark that peer unavailable and tell the user what was tried and why it failed. Do not silently proceed.

### Live-Run Observation

While the peer process is still running:

### Process Ownership And Foreground Fallback (Blocking)

Peer-dispatch completion is a process-lifecycle fact, not an inference from a shell return, a wrapper PID, or the current size of redirected output.

- Never dispatch a peer with manual shell detachment such as `nohup ... &`, `( ... ) &`, or a hand-rolled background wrapper. Those wrappers can exit while the actual peer continues, can lose a controlling TTY, and make a later retry overlap a live request.
- A peer is complete only after the dispatch owner has observed the **actual peer process** exit, reaped it, and captured its stdout and stderr. Do not use the PID of an intermediate shell, `nohup`, `script`, or harness wrapper as the liveness signal.
- If the current host provides a verified harness-managed background runner that exposes the actual child process lifecycle, use it. Otherwise, run deferred/buffered peers in the foreground, sequentially, and wait for each full result before dispatching the next peer.
- In that foreground fallback, `agy --print` must remain under its required PTY wrapper (`script -q /dev/null ...`); a fully detached PTY job is known to return only terminal-control bytes instead of a peer answer.
- For a Claude peer that needs tools, use `claude -p --output-format stream-json --verbose` (plus the narrow read-only tool policy). Parse its live JSON events and wait for its terminal `result` event; do not use one buffered `--output-format json` response as the only progress signal. In Claude CLI v2.1.201, `stream-json` requires `--verbose`.
- Do not retry, reframe, or dispatch a second request to the same peer until the previous request has been confirmed exited and reaped. An empty or zero-byte capture while the peer is alive is not a failure classification.
- If a foreground peer exits without usable stdout, record the exit status and stderr, classify the failure under the rules below, and only then consider the workflow's allowed retry.

- Treat process liveness and elapsed wall-clock time as the primary signal, not the current byte count of redirected stdout/stderr files.
- Keep the workflow timeout (`audit_timeout_seconds`, `cowork_timeout_seconds`, or `swarm_timeout_seconds`) as the hard ceiling.
- Use host-specific references for any peer-specific soft suspicion thresholds or buffering quirks.
- **BLOCKING RULE: Always run the Heartbeat Monitor below.** Every peer dispatch in `/cowork`, `/consensus`, `/debate`, and `/audit-work` MUST show heartbeat output to the user. This is not optional. If you dispatch a peer without a heartbeat, you have violated this rule.

### Heartbeat Monitor (Mandatory, Non-Blocking)

Start the heartbeat loop only after the Peer Handshake Gate succeeds. Do not run heartbeat checks during the ACK window itself.

Run a lightweight heartbeat every 30 seconds while ANY peer LLM process is running. Show the output to the user by default. This is **informational only** — it never kills, never blocks, never auto-escalates. It just reports so the user can see what's happening.

**Rules:**

- The heartbeat NEVER kills a peer process.
- The heartbeat NEVER blocks workflow progress.
- The heartbeat reports liveness and elapsed time. That's it.
- If the user wants to kill a stalled peer, they decide — not the heartbeat.

**What to check (every 30s):**

1. **Process liveness:** `kill -0 $PID` — is the peer process still alive?
2. **Elapsed time:** how long since dispatch?
3. **Output bytes (informational):** `wc -c < $STDOUT_FILE` — note that some peers buffer until exit.

**How to report:**

- While alive: `[peer-heartbeat] <peer_name> | alive | <elapsed>s`
- On exit: `[peer-heartbeat] <peer_name> | done | <elapsed>s | <bytes> bytes`

Keep it to one short line. Don't add stall warnings or recommendations — the user can read elapsed time themselves.

**Known buffering behavior by peer:**

- **Codex CLI** (`codex exec`): Buffers ALL stdout until process exit. Zero bytes during execution is normal. GPT-5.5 at xhigh reasoning takes 3-5 minutes for complex prompts. This is expected, not a stall.
- **Claude CLI** (`claude -p`): May buffer until exit in headless mode.
- **agy** (`agy --print`): Buffers until process exit (Tier 2). Typical response time 15-30s. If invoked with the wrong model name format it will hang indefinitely — always verify the model string with `agy models` first.
- **Gemini CLI** (`gemini -p`): Sunsetted for individual tier. Use `agy` instead.

**Cost:** Zero tokens, negligible CPU (~1ms per check). The heartbeat adds no peer interaction — it only inspects local process state and file size.

### Dispatch Cleanup

Dispatch copies are transport artifacts, not primary evidence.

- Keep the authoring packet in `<ADS_MEMORY_ROOT>/.local-artifacts/` or `<ADS_MEMORY_ROOT>/reports/` according to the user's retention choice.
- Delete temporary dispatch copies after the peer run finishes unless the user explicitly asks to retain them.
- If a local-only dispatch copy in `tmp/` should be kept after the run, move it into `<ADS_MEMORY_ROOT>/.local-artifacts/` instead of leaving it in the workspace `tmp/`.
- If the dispatch copy is retained temporarily for troubleshooting, say so and clean it up before closing the task when feasible.

## Failure Classification

Classify peer failures before retrying:

- `path_or_permission_failure`: peer could not read the packet or target files
- `capacity_or_rate_limit`: `429`, `503`, provider-capacity exhaustion
- `timeout`
- `malformed_or_no_output`
- `empty_result_transport_failure`: peer exited successfully but returned an empty answer body
- `truncated_output`

Only retry transient transport failures such as `429` and `503` by default.
Do not treat path/permission failures as model reasoning failures.
Fix the path, then retry once with the corrected dispatch copy.
Only classify `empty_result_transport_failure` after the peer process has exited successfully and stdout is still empty.
If a broad packet-based audit returns `empty_result_transport_failure`, retry once with a tighter prompt, a bounded file set, and a constrained read-only tool surface when the peer supports it.
If that retry falls back to plain text, keep the fallback on a shorter bounded timeout instead of reusing the full audit timeout again.

## Model And Prompt Hygiene

- Pin the model when the user requests it or when reproducibility matters.
- If the workflow promises exact model reporting, do not dispatch on an inferred, unknown, alias-only, or exact-unknown local default model. Require an explicit or locally proven exact model name/version before running.
- For `/consensus` and `/debate`, exact model reporting is mandatory. The Coordinator must run the Model Memory Map, including the smoke-test model-plan lookup, before showing any peer prompt preview. If any installed selected peer lacks an exact model ID, stop with a blocking model-proof gate; do not ask for or accept `run`.
- When resolving model names, always check `skills/swarm-consensus/references/cli-smoke-test.md` for documented model IDs before falling back to CLI probes or asking the user. That file is the canonical source for locally verified peer model names/versions.
- Before declaring a peer model unresolved, run the Model Memory Map below. Do not stop at `which <cli>` or `<cli> --version`; CLI version strings prove tool availability only, not model identity.
- If a requested Claude model is unproven locally or the CLI rejects it, run `skills/swarm-consensus/scripts/cli_smoke_test.py` in discovery mode before asking the user for another model. Do not keep guessing manually when the smoke harness already exists.
- If Claude rejects an alias and prints `Try --model to switch to ...`, treat that suggestion as a discovery candidate only. Do not switch to a different family/version until the Model Memory Map has been checked for an exact saved preference or model-plan `command_model`.
- For Claude consensus flows, use discovery with `--claude-require json`. For Claude audit flows that may need plain-text fallback, use `--claude-require both`.
- A valid Claude proof is any one of: an exact environment cache hit from `<ADS_MEMORY_ROOT>/reports/swarm-consensus/smoke-tests/last-known-good.json` with a real artifact path, an exact-model `session_success` earlier in the current session on the same host/CLI, or a fresh discovery run that writes a new artifact.
- If discovery finds a working exact model in the same requested family/version, use that exact model and say it was smoke-proven on this host. If discovery only finds a different family/version, stop and ask the user before switching.
- Keep the ask explicit: what to inspect, what to ignore, what output shape to return.
- Require strengths as well as findings so the user sees what should stay unchanged.

### Model Memory Map

Use this checklist for `/consensus`, `/debate`, `/audit-work`, `/cowork`, and any other external peer LLM dispatch. Its purpose is to prevent the Coordinator from forgetting where saved peer model preferences and proof artifacts live.

Check model sources in this order:

1. Per-run controls: `claude_model=...`, `gemini_model=...`, `codex_model=...`.
2. Project knowledge root evidence: resolve `<ADS_MEMORY_ROOT>` from `ADS_MEMORY_ROOT`, `ADS_PROJECT_KNOWLEDGE_ROOT`, `ADS_WORKSPACE_ROOT`, or sibling `ADS-memory/`, then inspect retained and local smoke-test caches, discovery reports, and consensus reports there. The retained cache is `<ADS_MEMORY_ROOT>/reports/swarm-consensus/smoke-tests/last-known-good.json`; a legacy local cache of the same name is still read as a fallback.
3. AI Dev Shop repo evidence: inspect repo `.local-artifacts/`, repo `reports/`, and bounded peer-dispatch packets under `tmp/peer-dispatch/`.
4. Workspace and home CLI config files that expose model defaults. Workspace config (`.gemini/settings.json` in repo root) takes precedence over home config (`~/.gemini/settings.json`). Claude CLI uses `~/.claude/settings.json`; Gemini CLI uses `model.name` in settings; Codex saves its model in `~/.codex/config.toml` and also reports it in the session startup header (`model: <id>`). These are fallback preferences such as `us.anthropic.claude-opus-4-6-v1[1m]` or `gemini-3.1-pro-preview`.
5. Candidate ladders: `skills/swarm-consensus/references/model-candidate-ladders.json`. These are discovery candidates, not proof by themselves.

**Explicitly invalid evidence (never use):**

- Asking the peer LLM "what model are you?" — models hallucinate their own identity. Self-report is not evidence regardless of how confidently the model answers.
- CLI version strings alone (e.g., `gemini --version` → `0.43.0`) — these prove tool availability, not model identity.

To make this lookup mechanical, run:

```bash
python3 skills/swarm-consensus/scripts/cli_smoke_test.py \
  --model-plan-only \
  --output-format json
```

Interpretation rules:

- Prefer exact model IDs over aliases. A provider-qualified saved model string is stronger retained evidence than a family alias.
- For Claude, the exact saved preference in `~/.claude/settings.json` can be passed directly to `claude --model` when `--model-plan-only` reports it as `command_model`; do not replace it with a lower-version CLI suggestion produced by an invalid alias.
- Treat a Claude cache entry as environment-exact proof only when hostname, OS, machine, Claude CLI version, transport requirement, and artifact path match the current run. If those do not match but an exact model appears in retained smoke reports or consensus reports, use it as a saved preference and say current-host proof is stale or requires a fresh smoke test.
- Treat project knowledge and repo-local evidence as higher priority than home CLI defaults; home defaults are still required fallback sources when project/repo evidence is absent.
- Treat `~/.gemini/settings.json` `model.name` as the saved Gemini model preference when present. Do not demote it to unresolved just because `gemini --version` only returns the CLI version.
- For `/consensus` and `/debate`, a peer with no exact model after this lookup is blocked. Do not proceed by labeling it `local default, exact model unknown`; that phrase is a stop condition, not a dispatchable plan. A home/local default is acceptable only when the model-plan output provides an exact `command_model`.
- Never print `model unresolved` until every source in this map has been checked or is unavailable.

## Capability Discovery

Use these sources in this order:

1. local capability probes in `harness-engineering/validators/`
2. `framework/routing/capability-probes.tsv`
3. `framework/routing/compatibility-matrix.md`
4. host-specific smoke-test artifacts when they exist

Useful local references:

- `harness-engineering/validators/probe_host_capabilities.sh`
- `harness-engineering/validators/resolve_subagent_mode.sh`
- `framework/routing/capability-probes.tsv`
- `framework/routing/compatibility-matrix.md`
- `skills/swarm-consensus/references/cli-smoke-test.md`

## Reusable Rule

If a peer-LLM interaction pattern turns out to be host-sensitive, move it into a shared reference like this one instead of copying the rule into one command only.
