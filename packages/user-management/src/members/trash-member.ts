import type { RemoveEntity } from "@jini-ai/core/contracts/site/plugins-host";
import type { MemberRepoPort } from "./ports.js";
import { MemberConflictError, MemberNotFoundError, MemberValidationError } from "./types.js";

/** The trash actor, read off the core removal port so no CMS dependency edge is needed. */
type TrashActor = Parameters<RemoveEntity>[0]["actor"];

/** Move a member through the existing Trash adapter, which atomically revokes credentials.
 * The caller owns member.manage authorization. Restore and purge remain Trash operations.
 * @throws MemberNotFoundError for missing/trashed members, MemberConflictError on a stale version.
 * @complexity O(1) member lookup plus the bound Trash operation's bulk credential updates.
 */
export async function trashMember(
  input: { workspaceId: string; memberId: string; actor: TrashActor },
  deps: { members: MemberRepoPort; remove?: RemoveEntity; clock: { nowIso(): string } },
): Promise<{ deleted: true }> {
  if (!deps.remove) throw new MemberValidationError("Member Trash is unavailable in this runtime");
  const member = await deps.members.findById({ workspaceId: input.workspaceId, id: input.memberId });
  if (!member) throw new MemberNotFoundError(`member '${input.memberId}' was not found`);
  const result = await deps.remove({ workspaceId: input.workspaceId, id: member.id,
    display: { title: member.email, subtitle: member.name ?? null }, at: deps.clock.nowIso(),
    expectedVersion: member.version, actor: input.actor });
  if (result.ok) return { deleted: true };
  if (result.reason === "not-found") throw new MemberNotFoundError(`member '${input.memberId}' was not found`);
  if (result.reason === "version-changed") throw new MemberConflictError("Member changed; read it again before deleting");
  throw new Error("Member Trash unexpectedly reported a blocker");
}
