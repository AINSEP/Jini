import type { PostRecord } from "./post.js";

/** The slice of `AgentPauseHoldStore` the post reads need; injected so no read imports the composition layer. */
export interface AgentHoldReader {
  heldSince(required: { workspaceId: string }): Promise<string | null>;
}

/**
 * Drops rows an AGENT scheduled for after the pause began while a hold stands — the in-JS twin of
 * `repo.ts`'s `notHeldAgentSchedule` (read its doc for the why). Owner posts, agent posts scheduled
 * before the pause and unscheduled agent posts pass; no reader or no hold means nothing is dropped.
 * @complexity O(rows) plus one reader call.
 */
export async function withoutHeldAgentSchedule<T extends Pick<PostRecord, "createdByKind" | "publishAt">>(
  required: { workspaceId: string; rows: T[]; agentHold: AgentHoldReader | undefined },
  _optional: Record<string, never> = {},
): Promise<T[]> {
  const heldSince = (await required.agentHold?.heldSince({ workspaceId: required.workspaceId })) ?? null;
  if (heldSince === null) return required.rows;
  return required.rows.filter((row) => !(row.createdByKind === "agent" && row.publishAt != null && row.publishAt > heldSince));
}
