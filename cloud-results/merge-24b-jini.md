__FIRSTLINE__

# MERGE-24b — Jini continuation (items 1, 2, 4 + Jini leftovers), 2026-11-26

Unattended cloud run on Jini `integ/merge-24-2026-11-25`. Opus coordinated (high effort) and read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) first. 5 Opus-high subagents in total, at most 4 alive at once: test sweep part 1, J10 Email views, `fs-files/agent-tools`, J1a/J1c, and test sweep part 2. Tovu was read-only (the parallel Tovu run owns the Tovu gates). No codebase-memory tools, no RemoteTrigger, no `--no-verify`, no force-push, no tag or publish. `main`, `release/*` and merge-23 untouched.

**Start:** merged `origin/integ/merge-23-2026-11-25` (incl. `2c2961d56`, rename upgrade verifies only the ledgered current revision) into merge-24: `0ba3fd793`, no conflicts.

**Environment:** Node 22.23.5 (repo pins `~24`, so `RegExp.escape` tests are ENV), `pnpm install --frozen-lockfile` + `pnpm -r build` green on the merged tip. The machine ran at load ~10 with concurrent agents, so a few DB-dialect tests hit the 5 s default timeout; each passed alone or with `--testTimeout 30000` (classed ENV).

__BODY__
