---
name: handoff
description: Create compact, redacted continuation handoff documents when the user asks to hand work to another agent, continue in another CLI or model such as Codex to Claude, resume later, preserve session state, or produce a next-agent brief.
---

# Handoff

Create a short handoff that lets a fresh agent continue without rereading the whole conversation. Prefer pointers to durable artifacts over copied content.

## Workflow

1. Resolve the handoff target and focus from the user request. If unspecified, target a fresh agent on the same machine and focus on the current workstream.
2. Gather only durable evidence: changed files, relevant diffs, specs, ADRs, tasks, test output summaries, report paths, and unresolved decisions. Do not rely on memory for facts that can be checked.
3. Choose the save target:
   - Use `<ADS_MEMORY_ROOT>/.local-artifacts/handoff/` when AI Dev Shop project knowledge is available and writable.
   - Use the OS temp directory when project knowledge is unavailable, the user asks for temp storage, or the handoff is intentionally outside the workspace.
   - Return inline only when filesystem writes are unavailable or the user asks for inline output.
4. Redact secrets and sensitive personal data. Never include API keys, tokens, passwords, private keys, raw `.env` values, or unnecessary personal information.
5. Avoid duplicating existing artifacts. Reference PRDs, specs, ADRs, reports, issues, commits, diffs, and logs by path or URL with a one-line relevance note.
6. Write a compact Markdown handoff and return the file path plus the exact next-agent opening prompt.

## Document Shape

Use this structure unless the user requests a different format:

```markdown
# Handoff: <short focus>

Generated: <ISO-8601 timestamp>
Source agent/session: <agent and host if known>
Target: <agent/model/host if known>

## Next-Agent Prompt
<brief prompt the user can send to the next agent>

## Current State
<what is true now, grounded in inspected evidence>

## Completed Work
<bullets with files/artifacts changed or produced>

## Active Files And Artifacts
<paths/URLs and why each matters>

## Decisions And Constraints
<accepted decisions, repo rules, approvals, and constraints>

## Risks And Open Questions
<known uncertainty, blockers, and anything the next agent must not assume>

## Suggested Skills
<skills the next agent should load, with one-line reasons>

## Next Steps
<ordered, concrete continuation plan>

## Handoff Contract
- Inputs used: <conversation summary, file paths, commands, artifacts>
- Output summary: <what this handoff enables>
- Risks: <same risks, compressed>
- Suggested next assignee: <agent/persona/host>
```

## Quality Bar

- Keep it brief enough to paste into another agent if needed.
- Preserve exact file paths, commands run, test results, and pending user choices.
- Distinguish facts from inferred state.
- Include the current mode or framework status when the next agent must honor it.
- For AI Dev Shop sessions, remind the next agent to read `<AI_DEV_SHOP_ROOT>/AGENTS.md` first when entering the same repository.
- Do not mark work complete just because the handoff exists; state the real continuation point.
