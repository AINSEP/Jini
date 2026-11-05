# Job mcp


## Build X: MCP tools. Owner approved both design questions (11-05).
Plan: cloud/plans/X-mcp-sources-plan-result.md. Design: cloud/plans/2026-10-27-mcp-sources-design-v2.md. Owner rule: Tovu, Jini, enabled plugin and injected tools all reach the agent; only its personal MCP list is kept out by default.
Owner decisions: (1) write to a personal config only after Allow, only where nothing else works, one credential-free entry, foreign entries kept, backup first, card says it changes settings outside Tovu. (2) Lowering stops affected answers immediately; keep the partial answer labelled "Stopped because tool access changed."
Trim, which OVERRIDES the plan:
- Do plan steps 1 (W1), 2 (W2), 3 (lowering), 5 (W4), 6 (validation; L1-L3 stay written but not run). Use the new wording: "Tools provided here".
- CUT step 4's chat write tool. Keep the argument-free chat_settings_get read. Run facts at most 2 KiB, not 16.
- CUT all CUT-CANDIDATES, including new vendor bridges.
- W4 replaces the existing pre-consent repair in ensure-json-agent-install.ts; both bugs logged in open-bugs (Antigravity silent all-on; repair before consent, no backup).
