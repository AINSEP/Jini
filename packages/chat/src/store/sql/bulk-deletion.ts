import { sql } from 'kysely';
import type { ChatKernel } from '../runtime/kernel.js';
import type { ChatOwnerScope } from '../ports.js';
import { copyScope } from './boundary.js';

type PreviewRow = { id: string; pinned_at: unknown; active: unknown; recoverable: unknown };

/** Why a previewed chat is kept, or `undefined` when it may be deleted. */
function previewKeepReason({ row, open }: { row: PreviewRow; open: ReadonlySet<string> | undefined }): string | undefined {
  if (row.pinned_at !== null) return 'pinned';
  if (open === undefined) return 'unknown';
  if (open.has(row.id)) return 'open';
  if (row.active) return 'active';
  if (row.recoverable) return 'recoverable';
  return undefined;
}

/** Total stored bytes of the messages in the given conversations. */
async function measureMessageBytes({ kernel, ids }: { kernel: ChatKernel; ids: string[] }): Promise<number> {
  const text = sql<string>`content || coalesce(events_json, '') || coalesce(attachments_json, '')`;
  const length = kernel.dialect === 'sqlite' ? sql<number>`length(cast(${text} as blob))` : sql<number>`octet_length(${text})`;
  const measured = await kernel.run(db => db.selectFrom('ai_chat_messages').select(sql<number>`coalesce(sum(${length}), 0)`.as('bytes'))
    .where('conversation_id', 'in', ids).executeTakeFirstOrThrow());
  return Number(measured.bytes);
}

export function createChatBulkDeletion(
  { kernel, scope: inputScope, now, openConversations }: {
    kernel: ChatKernel; scope: ChatOwnerScope; now: () => number;
    openConversations: () => Promise<ReadonlySet<string> | undefined>;
  }, { previewLimit = 5000 } = {},
) {
  const scope = copyScope({ scope: inputScope });
  return {
    async preview({ before }: { before: number }, _optional = {}) {
      const rows = await kernel.run(db => db.selectFrom('ai_chats').select(['id', 'title', 'pinned_at', 'updated_at'])
        .where('scope_id', '=', scope.scopeId).where('owner_kind', '=', scope.ownerKind).where('owner_id', '=', scope.ownerId)
        .where('updated_at', '<', before)
        .select(eb => [
          eb.exists(eb.selectFrom('ai_chat_messages as m').select('m.id').whereRef('m.conversation_id', '=', 'ai_chats.id')
            .where('m.role', '=', 'assistant').where('m.run_status', 'in', ['queued', 'running'])).as('active'),
          eb.exists(eb.selectFrom('ai_chat_messages as m').leftJoin('assistant_run_attempts as a', 'a.message_id', 'm.id').select('m.id')
            .whereRef('m.conversation_id', '=', 'ai_chats.id').where('m.role', '=', 'assistant').where('m.run_id', 'is not', null)
            .where(eb => eb.or([eb('m.run_status', 'is', null), eb('m.run_status', 'not in', ['queued', 'running', 'succeeded', 'failed', 'canceled']), eb('a.recovery_deadline', '>', now())]))).as('recoverable'),
        ]).orderBy('updated_at').orderBy('id').limit(previewLimit).execute());
      const ids: string[] = [], kept: { id: string; title: string | null; reason: string }[] = [];
      const open = await openConversations().catch(() => undefined);
      for (const row of rows) {
        const reason = previewKeepReason({ row, open });
        if (reason) { kept.push({ id: row.id, title: row.title, reason }); continue; }
        ids.push(row.id);
      }
      const bytes = ids.length ? await measureMessageBytes({ kernel, ids }) : 0;
      return { ids, count: ids.length, bytes, before, kept };
    },
    async apply({ ids, before }: { ids: readonly string[]; before?: number }, _optional = {}) {
      if (ids.length > 500) throw new RangeError('Choose at most 500 chats at a time.');
      const sorted = [...new Set(ids)].sort();
      const deleted: string[] = [], kept: { id: string; title: string | null; reason: string }[] = [];
      for (let offset = 0; offset < sorted.length; offset += 50) await kernel.transaction(async () => {
        const batch = sorted.slice(offset, offset + 50);
        // The run-slot lock is the bulk fence: acceptance cannot start a run between recheck and delete.
        for (const id of batch) await kernel.lockKey(`chat-slot:${id}`);
        const open = await openConversations().catch(() => undefined);
        for (const id of batch) {
          const row = await kernel.run(db => db.selectFrom('ai_chats').select(['id', 'title', 'pinned_at', 'updated_at'])
            .where('id', '=', id).where('scope_id', '=', scope.scopeId).where('owner_kind', '=', scope.ownerKind).where('owner_id', '=', scope.ownerId).executeTakeFirst());
          if (!row) continue;
          const runs = await kernel.run(db => db.selectFrom('ai_chat_messages as m').leftJoin('assistant_run_attempts as a', 'a.message_id', 'm.id')
            .select([
              sql<number>`coalesce(max(case when m.run_status in ('queued', 'running') then 1 else 0 end), 0)`.as('active'),
              sql<number>`coalesce(max(case when m.run_id is not null and (m.run_status is null or m.run_status not in ('queued', 'running', 'succeeded', 'failed', 'canceled')) then 1 else 0 end), 0)`.as('unknown'),
              sql<number>`coalesce(max(case when a.recovery_deadline > ${now()} then 1 else 0 end), 0)`.as('recoverable'),
            ]).where('m.conversation_id', '=', id).where('m.role', '=', 'assistant').executeTakeFirstOrThrow());
          const reason = ([
            [row.pinned_at !== null, 'pinned'], [before !== undefined && Number(row.updated_at) >= before, 'cutoff'],
            [open === undefined, 'unknown'], [open?.has(id), 'open'],
            [runs.active, 'active'],
            [runs.unknown, 'unknown'],
            [runs.recoverable, 'recoverable'],
          ] as const).find(([keep]) => keep)?.[1];
          if (reason) { kept.push({ id, title: row.title, reason }); continue; }
          const removed = await kernel.run(db => db.deleteFrom('ai_chats').where('id', '=', id).where('scope_id', '=', scope.scopeId)
            .where('owner_kind', '=', scope.ownerKind).where('owner_id', '=', scope.ownerId).where('pinned_at', 'is', null)
            .$if(before !== undefined, query => query.where('updated_at', '<', before!)).returning('id').executeTakeFirst());
          if (removed) deleted.push(id);
          else kept.push({ id, title: row.title, reason: 'changed' });
        }
      });
      return { deleted, kept };
    },
  };
}
