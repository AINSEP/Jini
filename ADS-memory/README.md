# ADS Memory

This is the project-owned AI Dev Shop workspace. Commit retained project artifacts here so teammates and future agents can see the same durable context.

For the authoritative Jini architecture, porting decisions, and project entry point, read
`ADS-memory/reports/jini-port/START-HERE.md` and then
`ADS-memory/reports/jini-port/extraction-plan.md`. Treat `foundry/docs/` as the
repository's extended project-information library; use this workspace for durable decisions,
evidence, reports, and curated memory.

- `governance/`: project rules and the live constitution
- `knowledge/`: stable project memory, learnings, notes, and memory-store entries
- `sessions/`: session summaries (date, participants, models, Q&A, decisions)
- `specs/`: provider-native forward specs and planning artifacts
- `reports/`: retained ADRs, reviews, benchmarks, audits, and pipeline outputs
- `specs_as_built/`: curated current-state implementation knowledge generated from reverse-spec and post-implementation capture
- `meta/`: project-owned workflow notes, migration state, and workspace metadata
- `.local-artifacts/`: local scratch output ignored by git

Do not put secrets in this workspace. Keep short-lived local scratch in `.local-artifacts/`.
