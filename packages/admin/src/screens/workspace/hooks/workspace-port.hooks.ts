import type { AdminWorkspaceResponse } from "@jini-ai/core/contracts/site/cms-workspace";

/**
 * @file What the host's workspace controller hook needs from the outside world, as an interface
 * rather than a direct API-client import. Follows the `useX(dependencies)` / `useWiredX()` pair the
 * host's assistant-chats port documents (the canonical reference in its workspace) and the shape
 * `Jini redirects/SOURCE-RATIONALE.md` uses for a single-hook feature.
 *
 * `describeApiError` is deliberately NOT part of this port — a pure error-message rule with no
 * I/O, imported directly per the pattern's own carve-out (see `Jini redirects/SOURCE-RATIONALE.md`'s
 * identical note).
 */
export interface WorkspacePort {
  getWorkspace(): Promise<{ workspace: AdminWorkspaceResponse }>;
  updateWorkspace(required: { patch: { name?: string; slug?: string } }): Promise<{ workspace: AdminWorkspaceResponse }>;
}
