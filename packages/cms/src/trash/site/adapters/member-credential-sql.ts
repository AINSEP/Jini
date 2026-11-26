/**
 * @file Member-specific credential revocation around the existing table adapter. Status, version,
 * prior-marker restoration and purge remain owned by createTableTrashAdapter; this wrapper only
 * prevents a pre-trash session or sign-in link from becoming usable again after restoration.
 */
import type { TrashAdapter } from "@jini-ai/cms/trash";
import type { MarkerStore as TrashDb } from "./marker-sql.js";
import { loose } from "../../sql/entry-sql.js";
import { createMemberTrashAdapter as createAdapter } from "@jini-ai/cms/trash/site/adapters/member";

/**
 * Revokes sessions and consumes outstanding links in the marker/index transaction. Restoration
 * restores the prior member status but never restores credentials. A failed revocation rolls back
 * the move. No member payload is read or parsed.
 * @complexity O(s + t) affected credentials; three bulk updates on hide, one on restore.
 * s sessions and t sign-in links. The marker adapter holds the shared member lock.
 */
export function createMemberTrashAdapter({ adapter, db, tables }: { adapter: TrashAdapter; db: TrashDb; tables: { members: string; sessions: string; tokens: string } }, _optional: Record<string, never> = {}): TrashAdapter {
  return createAdapter({ adapter, transaction: ({ run }) => db.transaction(run),
    advanceCredentialFence: input => revokeMemberCredentials({ db, input, tables }),
    revokeSessions: async input => {
      await db.run(query => loose(query).updateTable(tables.sessions)
        .set({ revoked_at: input.at })
        .where("workspace_id", "=", input.workspaceId)
        .where("member_id", "=", input.entityId)
        .where("revoked_at", "is", null).execute());
    },
    consumeSignInLinks: async input => {
      await db.run(query => loose(query).updateTable(tables.tokens)
        .set({ consumed_at: input.at })
        .where("workspace_id", "=", input.workspaceId)
        .where("member_id", "=", input.entityId)
        .where("consumed_at", "is", null).execute());
    },
  });
}

async function revokeMemberCredentials({ db, input, tables }: {
  tables: Parameters<typeof createMemberTrashAdapter>[0]["tables"];
  db: TrashDb; input: Parameters<TrashAdapter["hide"]>[0];
}, _options = {}): Promise<void> {
  await db.run(query => loose(query).updateTable(tables.members)
    .set({ credentials_revoked_at: input.at })
    .where("workspace_id", "=", input.workspaceId).where("id", "=", input.entityId)
    .where(eb => eb.or([eb("credentials_revoked_at", "is", null),
      eb("credentials_revoked_at", "<", input.at)]))
    .execute());
}
