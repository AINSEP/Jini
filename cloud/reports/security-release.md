# security-release

Status: in progress.

Branch: `cloud/security-release`.

Integrated the requested branches from the pinned job bases without conflicts. No other cloud jobs were merged. Build, focused tests, release metadata, complexity checks and secret scanning are pending.

Integration commit: `e8511ad2a2b62c81ae1e376af9603248238c9283`.

Release preparation: 12 packages set to `0.6.23`; matching Tovu floors set. Catalogs and compiled chart approval updated from the generated payload. Tovu lockfile refresh is intentionally deferred until publication. No publication, tagging, deployment, main push, or force push performed.

Focused Jini behavior checks pass after one deterministic reporter correction and running the native Node test with its intended runner. MessageRow characterization: 130 tests pass before and after; complexity now meets 10. Existing complexity findings were reproduced at the pinned bases. Full build and remaining checks are in progress.

Exact packages to publish at `0.6.23`:

- `@jini-ai/agent-plugins`
- `@jini-ai/agent-runtime`
- `@jini-ai/agentic`
- `@jini-ai/chat`
- `@jini-ai/core`
- `@jini-ai/daemon`
- `@jini-ai/mcp`
- `@jini-ai/platform`
- `@jini-ai/ui`
- `@jini-ai/ui-kit`
- `@jini-ai/plugin-catalog`
- `@jini-ai/provider-plugins`
