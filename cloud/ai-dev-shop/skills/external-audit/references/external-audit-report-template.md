# External Audit Report

**Date:** <ISO-8601>
**Scope:** <work-log | current-diff | staged | last-commit | custom>
**Focus:** <the user's audit question>
**Suggested Changes Mode:** <patches | notes | none>
**Audit Packet:** <path>
**Dispatch Packet:** <peer-readable path or "same as audit packet">
**Planned Auditors:** <claude, gemini, codex, or explicit subset>
**Responded Auditors:** <auditor list or "none">
**Failed Or Skipped Auditors:** <auditor=list with reason or "none">
**Timeout:** <seconds per auditor or total policy>
**Proposed Fixes Artifact:** <path or "none">

## Work Log
- <what you did>
- <why>
- <verification run or not run>

## Internal Verification
- **Verifier persona:** <Code Inspection | TDD | Security | generic adversarial verifier>
- **Evidence packet:** <path or summary of what was included>
- **Excluded rationale statement:** confirmed excluded author-side rationale (implementation reasoning, confidence claims, dismissed alternatives)
- **Findings:** <hard blockers / escalations / advisories / none — with count>
- **Gate recommendation:** <hard blocker | escalation | advisory | no issue>
- **Mutation-quality interpretation:** <summary or N/A if sensor not active>
- **Residual risk:** <remaining uncertainty after internal verification>
- **External peer audit still required:** <yes/no and why>
- **Score:** <1-10>

## Auditor Matrix
| Auditor | Requested Model | Resolved Model | Selection Source | CLI Version | Score | Rationale | Path to 10 | Output Mode | Suggest Mode Used | Attempts | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| <claude | gemini | codex> | <requested or "n/a"> | <exact model name/version or "not proven"> | <per_run_override | saved_preference | local_cli_proof | smoke_test_discovery | unknown> | <version> | <1-10> | <one-sentence rationale> | <what would raise to 10, or "n/a" if 10> | <json | text> | <patches | notes | fell-back-to-notes | none> | <count> | <Responded | Failed | Timed out | Retry exhausted | Not installed | Skipped> |

## Degraded Coverage
- <none | planned auditor(s) failed/skipped/mis-scoped; state whether `min_auditors` was met and whether failed auditors should be retried with the same packet>

## Per-Auditor Scope Checks
### <Auditor CLI>
- **What it says it is auditing:** <the user request / focus as the auditor understood it>
- **Scope and target it used:** <work-log | current-diff | staged | last-commit | custom> and <commit, diff, or file set>
- **Files or artifacts it says it reviewed:** <packet, diff, commit, specific files, or "not stated">
- **Scope ambiguity or mismatch:** <none | describe the mismatch the auditor noticed>

## What The External LLMs Said

Show each auditor's full reasoning trace by default — the complete finding text and rationale as the auditor wrote it, not a condensed paraphrase. Condensing a single auditor's section is only acceptable when its raw output is disproportionately large next to the others (rare); even then, keep it lossless on substance (no dropped findings, evidence, or caveats) and trim only redundancy/filler. State plainly when a section has been condensed and why.

### <Auditor CLI> Findings By Severity
- <this auditor's findings in full — complete rationale per finding, not a summary>

### <Auditor CLI> Blockers
- <real blockers, or "none">

### <Auditor CLI> Optional Improvements
- <non-blocking improvements, or "none">

### <Auditor CLI> Strengths
- <what the auditor said looked solid, in full, or "none stated">

### <Auditor CLI> Suggested Changes
- <this auditor's file-level suggestions in full, or "none returned">

## Per-Finding Rationales

### <Auditor CLI>
| Finding | Checked | Expected | Observed | Why It Matters | Recommended Fix | Confidence |
|---|---|---|---|---|---|---|
| <finding title or id> | <files/artifacts/commands/packet sections inspected> | <contract/behavior/invariant/quality bar> | <mismatch/omission/risk/evidence> | <impact> | <smallest actionable fix or decision needed> | <high/medium/low + uncertainty if any> |

## Cross-Auditor Synthesis

### Converged Findings
- <issues multiple auditors independently raised, or "none">
- <if the Coordinator disagrees with a converged finding, include it again in Decision Points For User with the evidence needed to override it>

### Single-Auditor Findings Worth Keeping
- <issues only one auditor raised that the Coordinator thinks are valid, or "none">

### Conflicts Or False Positives
- <auditor disagreements, weak claims, or false positives, with evidence>

### Missed-By-One Notes
- <important issue one auditor caught and another missed, or "none">

## Suggested Changes By Auditor
| Auditor | Suggested Change | Coordinator Handling |
|---|---|---|
| <claude | gemini | codex> | <file-level note, snippet summary, or "none"> | <accept | adapt | reject | defer> |

## Coordinator Response

### Agree
<what you agree with and why>

### Change
<what you think should change as a result>

### Disagree
<what you disagree with and why>

### Proposed Fix Handling
<accept as-is | adapt before applying | reject | none>

## Audit Outcome
- <keep as-is | patch now | rerun failed auditors | request more auditors | stop because blocked>
- <brief reason>

## Decision Points For User
- <keep as-is / patch now / save retained report / rerun failed auditors / request more auditors / etc.>
