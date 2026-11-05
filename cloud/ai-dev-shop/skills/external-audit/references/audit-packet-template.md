# External Audit Packet

## Ask

- **User request:** <what the user asked for>
- **Audit focus:** <what the external auditors should examine most closely>
- **Scope:** <work-log | current-diff | staged | last-commit | custom>
- **Suggested changes mode:** <patches | notes | none>
- **Audit target:** <commit, diff, or explicit file set>
- **Planned auditors:** <claude, gemini, codex, or explicit subset>
- **Authoring packet:** <where the coordinator wrote the canonical packet>
- **Dispatch packet:** <peer-readable packet path actually handed to each external auditor>

## Threat Model & Scope Contract (frozen)

- **Threat model id:** `TM-<id>` — **hash:** `<sha of this contract block>` (freeze before round 1; any material change starts a NEW audit series)
- **Audit round:** <1 = full threat-model pass | N = diff-only compliance pass>
- **Intended use / deployment context:** <how/where this artifact actually runs>
- **Allowed actors & capabilities:** <who can act and with what powers — the positive trust boundary>
- **In-scope blocking failure domains (ALLOWLIST):** <closed list, e.g. 1. unauthorized data exfiltration; 2. unrecoverable crash on normal use; 3. inadvertent user-data loss>. A blocking finding MUST map to exactly one of these domains or it is advisory, not blocking.
- **Mandatory invariants:** <correctness/safety properties that must always hold>
- **Blocking impact threshold:** <severity bar a finding must meet to block>
- **Risk tier & score floor:** <low = floor 7 | medium/high = floor 8.5> — carried in the packet so the auditor and coordinator apply the same number.
- **Gate formula (deterministic):** `blocking_gate = FAIL` iff `(count(validated unresolved blockers) > 0) OR (score < score_floor)`. The two terms are independent; neither rescues the other. The coordinator recomputes this from the returned validated blockers + score and rejects any auditor-returned gate that disagrees.
- **Explicit non-goals:** <what this work does not attempt>

## Prior-Round Disposition Ledger

_Empty on round 1. On re-audits, every prior finding appears here with a disposition._

| ID | Finding | Disposition | Evidence / rationale |
|---|---|---|---|
| `<id>` | <one line> | `fixed` \| `out-of-scope` \| `accepted-risk` \| `wontfix` | <commit/diff for fixed; adjudicated reason otherwise> |

## Work Log

- <action taken>
- <why it was done>
- <important tradeoff or design choice>

## Files And Artifacts

| Path | Why it matters |
|---|---|
| `<path>` | <reason> |

## Validation

- **Checks run:** <tests, smoke tests, diff review, none>
- **Checks not run:** <what was skipped>
- **Known caveats:** <limitations or uncertainty>

## Out-Of-Scope Local Changes

- <file or local change excluded from audit scope and why>

## Open Questions

- <question 1>
- <question 2>

## Auditor Instructions

Please review this work independently. Use the Ask section's `Audit target` and `Dispatch packet` fields as the source of truth for what to inspect and which packet path was actually handed to you. Evaluate strictly against the frozen **Threat Model & Scope Contract** above — do not silently revise it.

Do not assume any other auditor has seen the same issues you see. Return your own review only; the Coordinator will synthesize across auditors after all independent responses are collected.

Mindset: do not assume defects exist. **Attempt to falsify every mandatory invariant; a zero-findings result is valid** if the evidence supports it. Do not manufacture speculative findings to look thorough.

**Threat-model handshake (acceptance is the FIRST thing you compute, reported as `threat_model_accepted`/`rejection_reason` inside the single object below — do NOT emit a separate JSON block).** Before accepting, independently enumerate the artifact's actual normal-use surfaces, actors, capabilities, and material failure classes, then compare them to the contract's allowlist. **Reject** (`threat_model_accepted: false`) if the allowlist omits a material normal-use failure class, under-specifies the adversary for this artifact, or appears narrowed to guarantee a pass; state the omission in `rejection_reason`. If you reject, return the object with empty `findings` and do not score.

**Round behavior.** If `Audit round` is `1`, perform a full threat-model pass over the named surfaces. If `Audit round` is `N`, act as a Compliance Inspector: (a) reconcile each Prior-Round Disposition Ledger entry, and (b) audit the unified diff **plus the minimum unchanged context needed to judge the diff's behavioral effects** (callers, consumers, config, invariants it touches) for NEW violations. Do not re-audit unrelated untouched code to invent new issue classes; every round-N finding must state its causal link to the diff.

**Ledger reconciliation (round N).** Match each finding to prior ledger entries by underlying causal claim and affected surface, NOT by ID or wording. A ledger entry you cannot verify as genuinely resolved (e.g. a `fixed` claim with no corresponding change in the diff) is itself a **blocker** mapping to the gate-evasion / non-convergence domain. A non-diff late finding is admissible only with materially new evidence that was unavailable in round 1, recorded in `round_1_miss_justification`, and is flagged for human adjudication rather than auto-escalated.

**Blocker rule.** A finding is a **blocker only if** an allowed actor/execution violates a mandatory invariant with concrete evidence, AND it maps to exactly one **in-scope blocking failure domain** from the allowlist, AND it meets the blocking impact threshold. Decide this BEFORE assigning any score. Anything that fails this test is `advisory`, `out-of-scope`, or `unsupported` — never a blocker. A finding that passes it cannot be downgraded to preserve a score, and no finding can be promoted to a blocker by the score (including `path to 10` items).

**No denylist routing.** You may not escalate an excluded concern by renaming its class. To raise something resembling an excluded item, prove it occurs during normal in-scope operation or that the excluded premise is unnecessary — and map it to an allowlist domain.

**Escape valve (prevents false negatives).** If you find a catastrophic issue that falls OUTSIDE the pinned threat model, do NOT lower the score or block the gate — record it in `out_of_scope_fatal_warnings` so the human still sees it.

**Late-finding honesty.** On round N, a new finding caused by the diff states its `diff_causal_link`. A finding NOT caused by the diff is admissible only under the Ledger reconciliation rule above (materially new evidence unavailable in round 1 + flagged for human adjudication) and must carry a `round_1_miss_justification` — the justification alone does not make it admissible, so it cannot be used to restart escalation on unchanged work.

Return a single structured object plus prose, in this shape:

Return exactly ONE JSON object (no other JSON blocks) in this shape:

```json
{
  "threat_model_accepted": true,
  "rejection_reason": "",
  "auditor_scope_check": "what you audited, active scope/target, files reviewed, any mismatch",
  "ledger_updates": [{"id": "...", "verified": true, "note": "...", "causal_claim": "..."}],
  "findings": [{
    "id": "...", "severity": "blocker|high|medium|low",
    "in_scope_domain": "<allowlist domain or null>",
    "diff_causal_link": "<round N only: how the diff causes this>",
    "round_1_miss_justification": "<only if a non-diff late finding; cite materially new evidence>",
    "rationale": {"checked": "...", "expected": "...", "observed": "...",
                  "why_it_matters": "...", "recommended_fix": "...", "confidence": "high|medium|low"}
  }],
  "out_of_scope_fatal_warnings": [],
  "score": 0,
  "score_rationale": "one sentence",
  "blocking_gate": "PASS|FAIL — set FAIL if ANY validated blocker is unresolved OR score is below the contract score_floor; the coordinator will recompute and reject a gate inconsistent with these inputs",
  "closure": "COVERAGE_COMPLETE — round-<n> coverage finished under TM-<id>; see blocking_gate for the pass/fail outcome."
}
```

Severity taxonomy: `blocker` = must fix before relying on the work; `high` = real risk if ignored; `medium` = notable improvement or maintainability risk; `low` = minor polish. Include file references whenever possible. Then add prose for: what looks solid and should stay unchanged; and, per `Suggested changes mode` — `notes` = file-level edit guidance and concise snippets; `patches` = the above plus `Proposed File Changes` (unified diffs or bounded replacement snippets) only for files you actually reviewed, falling back to notes (and saying why) if scope is too uncertain for safe patches.
