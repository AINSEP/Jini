# Restart prompt — Jini port/refactor audit canaries

Paste the prompt below into a new Jini session started with network access and Git metadata writes pre-authorized. A prompt cannot override a managed sandbox, so choose a permission profile that permits `git fetch`/`git switch`, `gh pr view`, and dependency installation if you want the run to be autonomous.

```text
Resume the Jini port/refactor audit canary from the retained evidence at:

- ADS-memory/reports/port-refactor-audit-canary-2026-07-17.md
- ADS-memory/reports/port-refactor-audit-restart-prompt-2026-07-17.md

MANDATORY STARTUP:
1. Read AI-Dev-Shop/AGENTS.md and follow its Coordinator startup rules.
2. Read root AGENTS.md.
3. Read ADS-memory/reports/jini-port/START-HERE.md, extraction-plan.md, and refactor-roadmap.md.
4. Read ADS-memory/reports/jini-port/skills/fixing-open-design.md and fixing-open-design-web.md.
5. Read ADS-memory/reports/jini-port/god-components-extraction-plan.md.

USER CONSTRAINTS:
- Do not use git worktrees.
- Work sequentially in the primary checkout, one PR at a time.
- Retain the audit report in ADS-memory/reports/ and update it immediately after each completed PR checkpoint.
- The report must state the auditor model and reasoning-effort level. Give concise evidence-based reasoning summaries, never private chain-of-thought.
- Do not trust PR bodies, source maps, commits, or claimed coverage. Run and inspect the real commands and JSON evidence.
- Minimize interruptions. The session should begin with network and Git metadata permissions pre-authorized; do not request approval command by command if the host supports a suitable permission profile.
- Preserve and restore any user work. Check git status before switching. If changes are present, protect them reversibly and restore them at the end.

CANARIES:
1. Finish PR #12, `port/cli-transport-shell`, pinned head
   a119a114d88d16336566f21d98d710449a7f687a, base
   e3110ac6e576208a7f75753020f986b0de1ac7e7.
2. Then audit PR #13, `port/source-config-list-resource-dashboard`, pinned head
   13cde0eedfbd31d3bec24a6916fd52488f1c0c9c, same base.

DO NOT REPEAT COMPLETED PR #12 WORK unless an evidence file is missing. The retained report records:
- pinned install passed;
- package typecheck and build passed;
- coverage passed: 9 files, 95 tests, 288/288 statements, 178/178 branches,
  19/19 functions, 288/288 lines, every file 100% on all four metrics;
- coverage-summary.json and coverage-final.json existed;
- no suppression comments found;
- pnpm guard passed but reported itself as a skeleton;
- root pnpm typecheck failed only on inherited missing root tsconfigs in agent-runtime/chat-react;
- identity and forbidden-import scans were clean;
- the real OD clone was refreshed, cited commit ab453241 was verified in both remote histories;
- preliminary fidelity findings are recorded in the report and need final severity/verdict review.

For each PR, complete every original audit dimension:
1. Scope vs. extraction-plan §3 / god-components Consolidation map and source-map disclosures.
2. Package typecheck, build where applicable, tests, and coverage. Read json-summary and json directly. Report all four aggregate metrics and every per-file row; verify all executable touched source files are included.
3. Scan for every coverage-suppression equivalent.
4. Compare behavior against the exact real OD revision cited by source-map.md. Expected identifier renaming, injected ports, and de-branding are not defects. Report only undisclosed changed/missing behavior with Jini and OD file/line citations.
5. Run pnpm guard and manual identity/forbidden-import scans because guard may still be a skeleton.
6. Check cross-branch duplication, including viewport-switcher and flat-atom overlaps where relevant.

PR #13 specifically requires:
- full @jini/ui typecheck, tests, and coverage using its pinned lockfile;
- direct per-file verification for both source-config-list and resource-dashboard;
- i18n mechanism and real I18nProvider translation-test verification;
- React-layout-policy verification;
- fidelity comparison against every exact OD source revision cited in packages/ui/source-map.md;
- comparison with other UI branches for duplicate PillButton/PopoverMenu/status-pill/dashboard primitives;
- an immediate completed checkpoint written to the retained report before final synthesis.

VERDICT RULE:
- FAIL for any metric below 99%, missing executable files from measurement, suppression,
  boundary violation, required command failure introduced by the branch, or material undisclosed
  behavior loss/change.
- PASS WITH NAMED GAPS only when required gates pass and remaining gaps are explicitly disclosed,
  non-material, and safe to merge incrementally.
- PASS only when no merge-blocking or named non-blocking gaps remain.

At the end, return to main, restore the user's original changes, and provide a severity-ranked punch list plus a clickable link to the retained report.
```

## State at handoff

- The paused session had checked out PR #12 detached at `a119a114d`.
- The user's original main changes were protected in a stash named `codex-audit-canary-pr13-and-100pct-2026-07-17`.
- The paused session should restore `main` and apply that stash before ending. Verify current state rather than assuming this is still true in the restarted session.
