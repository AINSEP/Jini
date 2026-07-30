/**
 * `@jini-ai/core` DI token for `ArtifactStore`.
 *
 * Moved here from `@jini-ai/daemon/src/tokens.ts` on 2026-07-19: the locked kernel-noun set
 * (extraction-plan.md §2.1) is explicit that "projects, artifacts, design-systems, brands,
 * marketplace, conversations" are NOT kernel nouns, but `ArtifactStoreToken` had been declared
 * alongside the genuine kernel tokens (`RunLifecycleToken`, `EventLogToken`,
 * `ToolExecutorToken`, `AgentExecutorToken`) in `@jini-ai/daemon` — a real, shipped violation of
 * that rule, found by the 2026-07-19 swarm-consensus architecture debate (Codex GPT-5.6-sol,
 * confirmed independently by Gemini 3.1 Pro and Claude Opus 4.8; see
 * ADS-memory/reports/swarm-consensus/runs/2026-07-19T1632-consensus-report.md). Opus verified
 * before the fix that no consumer anywhere in the repo binds `jini.artifactStore`, so moving it
 * carries zero migration cost today — exactly the "still cheap, closing window" case the
 * debate flagged. `@jini-ai/artifacts` is an unlocked (incubating) package — see `UNLOCKED.md` —
 * matching `extraction-plan.md` §12 C7's pattern for a kernel-adjacent-but-not-kernel
 * capability: "a provider bound via the registry, not a kernel service."
 */
import { token } from '@jini-ai/core';
import type { ArtifactStore } from './store.js';

export const ArtifactStoreToken = token<ArtifactStore>('jini.artifactStore');
