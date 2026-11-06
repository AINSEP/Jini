# Job folder-moves (owner-approved 11-05; plan approved with this trim)
Plan: cloud/plans/FM-folder-moves-plan.md. This job file overrides it.
Base: origin/cloud/combine, at its current tip, after all other branches merged. Work directly on cloud/combine; nothing else runs at the same time. --no-verify is approved there.
Do groups 2, 3 and 7, in that order, one revertible commit per group. Do group 4 (External MCP) only if you have at least an hour of the cap left. Drop the other five groups. Moves change no behaviour and keep every "why" comment; prove it with the plan's byte comparison. If time runs out mid-group, undo that group alone.
Tests only for what you change; full suites run later. No skipping or weakening tests or rules. No publish, tag or main. Report at cloud/reports/folder-moves.md and in your final message: shas, exact files, tests with commands, anything open. General wording in commits and notes.
