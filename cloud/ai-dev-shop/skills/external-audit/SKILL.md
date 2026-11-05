---
name: external-audit
version: 1.5.0
last_updated: 2026-06-17
description: Package the current work for one or more external LLM auditors, capture independent reviews, and return a decision-ready cross-auditor synthesis to the user.
---

# Skill: External Audit

**This skill is OFF by default.** Use it only when the user explicitly asks for another LLM to audit, check, or review the current work.

## When to Use

- User asks to have another LLM check your work
- User asks to have multiple LLMs audit, compare, or cross-check the current work
- A toolkit-maintenance change needs independent scrutiny before the user decides whether to keep it
- You want external models to review a diff, a commit, or a bounded workstream independently and then compare their feedback against each other and your own judgment

## Scope

This is not the same as pipeline `/code-inspection`, which routes implementation to the Code Inspection Agent and Security Agent.

This skill is for:
- one packaged audit packet
- one or more external auditor CLI calls
- one synthesis back to the user with explicit cross-auditor agreement, disagreement, omissions, and Coordinator judgment

This workflow is **packet-first**. Default to a curated work-log packet, not a blind diff against the last push.
Use `skills/llm-operations/references/peer-llm-dispatch.md` for shared packet, transport, diagnostics, and capability rules.
If any planned auditor is Claude, also use `skills/llm-operations/references/claude-code-cli-audits.md`.

## Auditor Selection Rules

- Prefer a different model family from the current host.
- Do not use a same-family child/subagent as the external auditor by default.
- If the user explicitly wants same-family review, say so clearly and note that it is weaker independence.
- Never hallucinate an auditor response. If no external CLI is available, stop and say so.
- When `auditors=` is provided, run that explicit comma-separated set. `auditors=all` is the explicit spelling of the default all-available behavior for scripts and still excludes the current host family unless `allow_same_family=true`.
- If an explicit auditor list names the current host family, treat that as an explicit same-family request for that auditor and say that independence is weaker.
- If `auditors=` names an explicit list and `min_auditors=` is omitted, set `min_auditors` to the number of requested auditors so missing requested auditors cannot be silently dropped.
- When legacy `auditor=` is provided, run exactly that one auditor.
- When both `auditors=` and `auditor=` are omitted, filter out the current host family by default, then choose all available external CLIs in this exact order: `claude`, `gemini`, `codex`.
- If fewer than `min_auditors` are available, stop and tell the user which auditors were available, unavailable, or excluded.
- If no different-family external CLI is available, stop and tell the user instead of silently falling back to the same family. Only use a same-family auditor when the user explicitly asks for it.

## Runtime Controls

- `auditors=<claude,gemini,codex|all>`: choose multiple external auditor CLIs explicitly
- `auditor=<claude|gemini|codex>`: choose the external auditor CLI explicitly
- `min_auditors=<int>`: minimum number of auditors required before dispatch; default `1`, or the explicit auditor count when `auditors=` names a list and `min_auditors=` is omitted
- `allow_same_family=<true|false>`: include the current host family when resolving `auditors=all`; default `false`
- `reuse_packet=<path>`: rerun a prior canonical packet, usually to retry failed auditors without reframing the ask
- `scope=<work-log|current-diff|staged|last-commit>`: choose the default work surface
- `suggest_changes=<patches|notes|none>`: control whether auditors should return file-level change proposals; default `patches`
- `audit_timeout_seconds=<int>`: maximum wall-clock wait for each auditor call (default `300`)
- `claude_model=<exact-id>`: per-run Claude model override with an exact model name/version
- `gemini_model=<exact-id>`: per-run Gemini model override with an exact model name/version
- `codex_model=<exact-id>`: per-run Codex model override with an exact model name/version

If controls are omitted, infer only non-model defaults and tell the user what was chosen before dispatch. Do not infer an exact auditor model name/version unless it is locally proven.
Default behavior is `suggest_changes=patches`, not audit-only. The auditor should propose changes when changes are warranted and the file context is grounded enough.

## Step 1 — Preflight

Native Windows shells are not yet verified for this workflow. The path strategy is OS-agnostic, but the command examples in this skill assume a Bash-compatible shell. On Windows, prefer Git Bash or WSL for now, or translate the shell snippets to PowerShell equivalents before relying on them.

Before building the packet, inspect the external CLI surface:

```bash
which claude && claude --version 2>/dev/null || echo "claude: not installed"
which gemini && gemini --version 2>/dev/null || echo "gemini: not installed"
which codex  && codex  --version 2>/dev/null || echo "codex: not installed"
```

Then:

1. Record which external CLIs are available.
2. Exclude the current host family unless the user explicitly asks to use it anyway through `allow_same_family=true` or by naming that auditor in an explicit `auditors=` list.
3. Determine the planned auditor set using `## Auditor Selection Rules`.
4. If fewer than `min_auditors` are available, stop before dispatch and report the available, unavailable, and excluded auditors.
5. Resolve every planned auditor model using this order:
   - per-run override naming an exact model/version
   - saved user preference naming an exact model/version
   - documented model IDs in `skills/swarm-consensus/references/cli-smoke-test.md` (the canonical source for locally verified peer model names)
   - local CLI or config evidence that proves the exact model/version
6. Before running any Claude discovery, check whether the exact requested Claude model already succeeded earlier in the current session on this same host/CLI combination. If yes, treat that as `session_success` proof and reuse the exact model directly. Do not rerun the smoke-test harness just because the on-disk cache is absent. Only fall through to discovery when the exact model is still unknown, the earlier session proof is ambiguous, or the Claude CLI rejects the same model on this run.
7. If a planned auditor is Claude and the requested or saved Claude model is still unproven after the session-success check, or the CLI rejects it, run the smoke-test harness in discovery mode before asking the user to supply another model:

```bash
python3 skills/swarm-consensus/scripts/cli_smoke_test.py \
  --discover-claude \
  --claude-model <requested-or-saved-model> \
  --claude-require both \
  --output-format json
```

Use the discovered `winner.model` only when it matches the requested family/version and it passed both JSON and text mode locally. If discovery finds only a different family/version, stop and ask the user before switching.
A valid Claude proof is any one of:
- an exact environment cache hit from `<ADS_MEMORY_ROOT>/reports/swarm-consensus/smoke-tests/last-known-good.json` with a real artifact path
- an exact-model `session_success` earlier in the current session on the same host/CLI, with a known prior audit/consensus artifact or explicit operator confirmation
- a fresh discovery run that writes a new artifact for the current environment
Discovery is fallback, not default. Do not rerun it just because the cache file is absent when the exact model is already proven in-session.
8. If any exact planned model/version is not resolved by any source above, stop before dispatch and ask:

`Planned auditors: <CLI=model-or-unproven list>. Exact model/version is not proven for: <CLI list>. Reply with auditors=... and claude_model=..., gemini_model=..., or codex_model=... using exact model name/version(s) to proceed.`

Do not silently switch to a newer model family/version just because it exists locally.
Do not dispatch using a local default, alias assumption, or inferred family name when this workflow promises exact model reporting.
9. Resolve the effective `suggest_changes` mode:
   - default to `patches`
   - keep `patches` only when the packet names a bounded enough file set that auditors can ground file-level proposals safely
   - if the scope is too broad, ambiguous, or mostly conceptual, downgrade to `notes` and say so before dispatch
   - use `none` only when the user explicitly disables suggestions

## Step 2 — Build The Audit Packet

Use `skills/external-audit/references/audit-packet-template.md` as the layout reference.

If `reuse_packet=<path>` is set, validate that the file exists and use it as the canonical authoring packet. Do not rebuild, summarize, reorder, or otherwise reframe the packet; the point of packet reuse is to let failed auditors inspect the same frozen context that successful auditors already saw.

The packet must capture:

- the original user request
- the exact scope under review
- the effective `suggest_changes` mode
- the audit target reference (commit, diff, or explicit file set)
- what you changed
- why you changed it
- relevant files and artifacts
- tests/verification performed
- tests/verification not performed
- known risks, caveats, and open questions
- any unrelated worktree changes excluded from the audit scope
- the specific questions you want the external auditors to answer

Default behavior:

- `scope=work-log` is the default
- build the packet from the coordinator's work log plus the touched-file list and verification notes
- attach commit or diff references only when they materially help the auditor inspect details
- do not default to `origin/main..HEAD`, `last push`, or another broad diff unless the user explicitly asks for that view

Default packet path:

` <ADS_MEMORY_ROOT>/.local-artifacts/external-audit/packets/<timestamp>-audit-packet.md `

If the user explicitly wants the packet retained as project evidence, save it instead at:

` <ADS_MEMORY_ROOT>/reports/external-audit/packets/<timestamp>-audit-packet.md `

Packets are scratch by default unless the user explicitly asks to retain them.

## Step 3 — Dispatch The External Auditors

Prompt each external auditor to review the same packet independently, not just the bare diff summary.

Use `skills/llm-operations/references/peer-llm-dispatch.md` for the rule set.

Dispatch workflow:

1. Keep the authoring packet in `<ADS_MEMORY_ROOT>/.local-artifacts/` or `<ADS_MEMORY_ROOT>/reports/` according to the user's retention choice.
2. Prefer a self-contained `stdin` payload when the packet plus any needed excerpts fit cleanly in one bounded audit prompt.
3. If the peer still needs to read a packet from disk, follow the file-transport and readability-probe rules in `skills/llm-operations/references/peer-llm-dispatch.md`.
4. Use the dispatch packet path, not the authoring packet path, in the actual audit prompt when file-based transport is used.
5. If an auditor CLI is Claude, apply `skills/llm-operations/references/claude-code-cli-audits.md` and prefer its dedicated runner when available. Pass the exact proven Claude model to the runner instead of relying on the local default.
6. Construct every auditor prompt from the canonical packet before dispatching the first auditor. If dispatch must be sequential, do not revise, reframe, add emphasis, or change file targets for later prompts based on earlier auditor responses.
7. Run peer calls in parallel when practical. If they must run sequentially, keep prompts independent and do not include one auditor's answer in another auditor's prompt.

Audit prompt requirements:

1. State that this is an independent audit of the packaged work.
2. Ask for findings ordered by severity using this taxonomy: `blocker` means must fix before relying on the work; `high` means real risk if ignored; `medium` means notable improvement or maintainability risk; `low` means minor inconsistency or polish.
3. Ask for file references when possible.
4. Ask which issues are real blockers vs optional improvements.
5. Require a concise `Finding Rationale` for every finding. Do not ask for private chain-of-thought. The rationale must expose audit evidence in this structure:
   - `Checked:` files, artifacts, commands, or packet sections inspected
   - `Expected:` the contract, behavior, invariant, or quality bar the work should satisfy
   - `Observed:` the concrete mismatch, omission, risk, or evidence found
   - `Why it matters:` user, correctness, security, maintainability, or workflow impact
   - `Recommended fix:` the smallest actionable fix or the decision needed
   - `Confidence:` high, medium, or low, with the main uncertainty if not high
6. Ask for a short strengths section so the user sees what each auditor thinks is solid.
7. Require each auditor to begin with an `Auditor Scope Check` before any findings. That scope check must restate what it believes it is auditing, the active scope and audit target, which files or artifacts it actually reviewed, and any ambiguity or mismatch it noticed.
8. Prefer a short prompt that references the dispatch packet path over embedding the full packet body inline when the peer can read files directly.
9. If the packet already contains a bounded file list, prefer a bounded sectioned prompt over an open-ended repo audit prompt.
10. For Claude Code packet-first audits, prefer a constrained `Read`-only tool surface when that is enough to inspect the packet and the listed files.
11. If `suggest_changes=notes`, require a `Suggested Changes` section with file-level edit guidance and concise replacement snippets when useful.
12. If `suggest_changes=patches`, require a `Suggested Changes` section plus a `Proposed File Changes` section with unified diffs or bounded replacement snippets only for files the auditor actually reviewed. If safe patching is not grounded enough, require the auditor to fall back to notes and explain why.
13. Never ask auditors to apply edits or assume their patches are authoritative. Suggested changes are proposal-only artifacts for later review.

Prefer structured output when the CLI supports it.

- Parse `stdout` only as each auditor answer.
- Treat `stderr` as diagnostics.
- Save raw stdout/stderr captures to `<ADS_MEMORY_ROOT>/.local-artifacts/external-audit/offloads/<timestamp>/<auditor>/` by default.
- Only retain raw offloads in `<ADS_MEMORY_ROOT>/reports/offloads/` if the user explicitly asks for retained evidence.
- Use host-specific references for auditor-specific transport quirks instead of restating them inline.

Retry policy:

- Retry clear transient failures such as `429`, `503`, rate-limit, or provider-capacity messages.
- Only classify `empty_result_transport_failure` after the peer process exits successfully and stdout is still empty.
- On `empty_result_transport_failure`, retry once with a tighter bounded prompt and a constrained read-only tool surface when the peer supports it.
- Use any host-specific retry bounds or fallback guidance from the host reference you loaded.
- Use bounded backoff.
- Stop after at most 2 retries.
- Never exceed `audit_timeout_seconds`.

Multi-auditor failure policy:

- If all planned auditors fail, stop and report the failure matrix to the user instead of synthesizing findings.
- If some but not all auditors fail, proceed only when the number of successful respondents meets `min_auditors`.
- If successful respondents are fewer than `min_auditors`, stop and ask whether to retry failed auditors with `reuse_packet=<path>`, proceed with explicitly degraded coverage, or abort.
- If successful respondents meet `min_auditors` but at least one planned auditor failed, include a prominent `Degraded Coverage` section before synthesis and add a decision point to rerun failed auditors from the same packet.
- Do not count an auditor as successful when its `Auditor Scope Check` says it could not review the canonical packet or target scope.

## Step 4 — Synthesize Back To The User

Your final answer must not stop at "here is what the auditors said."

You must add your own judgment in separate sections:

- what each external auditor said it was auditing
- what each external auditor said
- where auditors independently agreed
- where auditors disagreed
- what one auditor caught that another missed
- what suggested changes each auditor returned, if any
- what you agree with
- what you think should change
- what you disagree with and why
- whether you would accept, adapt, or reject the proposed file changes
- what decision the user needs to make next

If two or more auditors independently converge on the same finding, do not dismiss it in `Disagree` without flagging it as a `Decision Points For User` item. Converged findings carry higher weight than single-auditor findings and require explicit evidence or user sign-off to override.

If an auditor is wrong, say so plainly and explain why using inspected evidence.
If an auditor is right, say what you would change and whether you should patch it now.

If suggested changes were returned, save them as artifacts using
`skills/external-audit/references/proposed-fixes-template.md`.

Default proposed-fixes path:

` <ADS_MEMORY_ROOT>/.local-artifacts/external-audit/proposed-fixes/<timestamp>/ `

Retained path only when the user explicitly asks:

` <ADS_MEMORY_ROOT>/reports/external-audit/proposed-fixes/<timestamp>/ `

Always save the raw proposal extract to `proposed-fixes.md`. Split unified diffs
into `patches/<auditor>-<nnnn>-<slug>.diff` only when an auditor actually returned
grounded patch blocks. Do not apply these files automatically.

## Step 5 — Output

### Template Guard

Use `skills/external-audit/references/external-audit-report-template.md` as the reference layout for inline output and saved reports.

1. Use the section order below for inline output and saved reports.
2. Do not collapse the external audit into a prose blob.
3. Before writing the final report to disk, if the user has not already specified retention, ask:

`Save external audit report? Reply "save report" to retain it in <ADS_MEMORY_ROOT>/reports/external-audit/runs/, "local only" to keep it in <ADS_MEMORY_ROOT>/.local-artifacts/external-audit/runs/, or "inline only" for no file.`

4. Default saved location for ad hoc runs:

` <ADS_MEMORY_ROOT>/.local-artifacts/external-audit/runs/<timestamp>-external-audit-report.md `

5. Retained location when the user explicitly wants to keep it:

` <ADS_MEMORY_ROOT>/reports/external-audit/runs/<timestamp>-external-audit-report.md `

6. The report must explicitly separate:
   - which external LLMs were planned, dispatched, responded, failed, or skipped
   - what each external LLM said it was auditing
   - what each external LLM said
   - the per-finding rationale each auditor gave, including checked/expected/observed/impact/fix/confidence
   - where auditors agreed, disagreed, or missed issues another auditor caught
   - what suggested changes each auditor returned
   - what you agree with
   - what you would change
   - what you disagree with
   - how you would handle the proposed changes
   - the resulting audit outcome
7. If an auditor did not respond successfully, keep the same template and state that clearly in `What The External LLMs Said` and `Audit Outcome`.
