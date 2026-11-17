# lu-s1 (Jini side) — lost updates S1, external MCP

Full report: Tovu `cloud-results/lu-s1.md` on branch `wave2/lu-s1` (Tovu repo). This file lists the Jini part only.

Branch `wave2/lu-s1` from `origin/refactor/terra` (`65d73b0d5`). Commits, all pushed:

- `397e4bf3` `ExternalMcpServerRecord.version`; port gets `insert` / `updateIfVersion` / `updateOAuthRuntime`; memory repo; access approval advances `version`
- `ae6b1c23` sign-in `persistTokens` / `setOAuthStatus` write only OAuth runtime columns (refresh no longer re-enables a server an admin disabled); `oauth-row-writes.ts`
- `713790dc` `saveExternalMcpServer` → `insert` / `updateIfVersion` (`expectedVersion`, one retry when only a refresh moved a credential); view carries `version`
- `5d9ad00c` plugin adoption + tool renames are conditional writes; core `applyInternalChange` (rule M4)
- `de1428a3` in-memory session repo never restores a revoked session on save (security hazard; SQL adapters fixed in Tovu)
- `10f16be1` neutral-host double follows the port

Gates: `pnpm guard` ok; `pnpm -r --if-present run typecheck` exit 0; vitest core 2940, mcp 1784, integrations 2053, agent-plugins 2165 (2 skipped), user-management 1235, examples/neutral-host 66 — all pass.
Size rule (LU-B1): `store.ts` 1658 (was 1671), `sign-in.ts` 1044 (1044), `federate-mcp.ts` 595 (595).
Left: `upsert` is still on the port (no production caller; ~200 Tovu test seeds); S3 not started. Next step is in the Tovu report.
