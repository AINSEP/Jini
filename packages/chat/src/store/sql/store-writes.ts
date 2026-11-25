/**
 * Write-side statements of the owner-bound SQL chat store. Every statement runs through the
 * injected {@link SqlStoreContext}. `writeMessage` owns exactly one kernel transaction; its
 * steps are separate functions only so each stays small, they never open a transaction of their own.
 */
import { isUniqueViolation } from '@jini-ai/core/contracts/storage';
import { withFolderReceipt } from '../../core/accepted-input.js';
import type { ChatMessage } from '../../core/messages.js';
import type { ChatConversation, ChatTitleSource, CreateChatConversationInput } from '../ports.js';
import { ChatStoreError } from '../errors.js';
import { conversationLockKey, encodeMessageRow, updateOwnedMessageConflict, type MessageRow } from './store-rows.js';
import { getConversation, ownedMessages, type SqlStoreContext } from './store-queries.js';

/** Insert one conversation for this scope; a duplicate ID is a `conflict`, any other failure propagates. */
export async function createConversation({ ctx, input }: { ctx: SqlStoreContext; input: CreateChatConversationInput }): Promise<ChatConversation> {
  const { scopeId, ownerKind, ownerId } = ctx.scope;
  const ts = ctx.clock.nowMs();
  try {
  await ctx.run((db) =>
    db
      .insertInto("ai_chats")
      .values({
        id: input.id,
        scope_id: scopeId,
        owner_kind: ownerKind,
        owner_id: ownerId,
        title: input.title ?? null,
        title_source: input.titleSource ?? "fallback",
        created_at: ts,
        updated_at: ts,
        expires_at: input.expiresAt ?? null,
      })
      .execute()
  );
  } catch (cause) {
    if (isUniqueViolation({ err: cause })) throw new ChatStoreError({ code: 'conflict' }, { cause });
    throw cause;
  }
  const created = await getConversation({ ctx, id: input.id });
  // Unreachable: the insert used this exact scope. Asserted so a future change to either
  // statement fails loudly instead of returning a malformed conversation.
  if (!created) throw new Error(`ai_chats: created conversation ${input.id} was not readable in its own scope`);
  return created;
}

/** Rename an owned conversation, then return its fresh projection (null when absent or foreign). */
export async function renameConversation(
  { ctx, id, title, source }: { ctx: SqlStoreContext; id: string; title: string; source: ChatTitleSource },
): Promise<ChatConversation | null> {
  const { scopeId, ownerKind, ownerId } = ctx.scope;
  // A generated title never overwrites a typed one: in the WHERE clause, so a concurrent
  // rename cannot slip between a read and this write.
  await ctx.run((db) =>
    db
      .updateTable("ai_chats")
      .set({ title, title_source: source, updated_at: ctx.clock.nowMs() })
      .where("id", "=", id)
      .where("scope_id", "=", scopeId)
      .where("owner_kind", "=", ownerKind)
      .where("owner_id", "=", ownerId)
      .$if(source === "generated", (qb) => qb.where("title_source", "<>", "manual"))
      .execute()
  );
  return getConversation({ ctx, id });
}

/** Bump an owned conversation's activity time, optionally replacing its expiry. */
export async function touchConversation(
  { ctx, id, options }: { ctx: SqlStoreContext; id: string; options: { readonly expiresAt?: number } },
): Promise<void> {
  const { scopeId, ownerKind, ownerId } = ctx.scope;
  const ts = ctx.clock.nowMs();
  await ctx.run((db) =>
    db
      .updateTable("ai_chats")
      .set(options?.expiresAt === undefined ? { updated_at: ts } : { updated_at: ts, expires_at: options.expiresAt })
      .where("id", "=", id)
      .where("scope_id", "=", scopeId)
      .where("owner_kind", "=", ownerKind)
      .where("owner_id", "=", ownerId)
      .execute()
  );
}

/** Delete an owned conversation; unknown and foreign IDs are no-ops. */
export async function deleteConversation({ ctx, id }: { ctx: SqlStoreContext; id: string }): Promise<void> {
  const { scopeId, ownerKind, ownerId } = ctx.scope;
  // Messages, agent sessions and tool approvals go with it through `ON DELETE CASCADE`.
  await ctx.run((db) =>
    db
      .deleteFrom("ai_chats")
      .where("id", "=", id)
      .where("scope_id", "=", scopeId)
      .where("owner_kind", "=", ownerKind)
      .where("owner_id", "=", ownerId)
      .execute()
  );
}

/** Whether this scope owns `conversationId`; a foreign ID is indistinguishable from a missing one. */
async function ownsConversation({ ctx, conversationId }: { ctx: SqlStoreContext; conversationId: string }): Promise<boolean> {
  const { scopeId, ownerKind, ownerId } = ctx.scope;
  const owned = await ctx.run((db) =>
    db
      .selectFrom("ai_chats")
      .select("id")
      .where("id", "=", conversationId)
      .where("scope_id", "=", scopeId)
      .where("owner_kind", "=", ownerKind)
      .where("owner_id", "=", ownerId)
      .executeTakeFirst()
  );
  return Boolean(owned);
}

async function nextPosition({ ctx, conversationId }: { ctx: SqlStoreContext; conversationId: string }): Promise<number> {
  const row = await ctx.run((db) =>
    db
      .selectFrom("ai_chat_messages")
      .select((eb) => eb.fn.max("position").as("max"))
      .where("conversation_id", "=", conversationId)
      .executeTakeFirst()
  );
  return row?.max === null || row?.max === undefined ? 0 : Number(row.max) + 1;
}

/** A rewritten message keeps its stored position; a new one is appended after the current maximum. */
async function messagePosition({ ctx, conversationId, messageId }: { ctx: SqlStoreContext; conversationId: string; messageId: string }): Promise<number> {
  const existing = await ctx.run((db) =>
    db
      .selectFrom("ai_chat_messages")
      .select("position")
      .where("id", "=", messageId)
      .where("conversation_id", "=", conversationId)
      .executeTakeFirst()
  );
  return existing ? Number(existing.position) : nextPosition({ ctx, conversationId });
}

/** Insert-or-update the encoded message row. */
async function upsertMessageRow({ ctx, conversationId, message, position }: { ctx: SqlStoreContext; conversationId: string; message: ChatMessage; position: number }): Promise<void> {
  const values = encodeMessageRow({ message, conversationId, position, now: () => ctx.clock.nowMs() });
  // The conflict target is `id`, the GLOBAL key: the `where` keeps an id that already lives in
  // another conversation from updating THAT row (the contract's "colliding id to its OWN chat" case).
  await ctx.run((db) => db.insertInto("ai_chat_messages").values(values).onConflict(updateOwnedMessageConflict).execute());
}

/** Every step of one message write, in order, on the ambient transaction and under the conversation lock. */
async function writeMessageSteps({ ctx, conversationId, message }: { ctx: SqlStoreContext; conversationId: string; message: ChatMessage }): Promise<MessageRow | null> {
  await ctx.kernel.lockKey(conversationLockKey(conversationId));
  if (!(await ownsConversation({ ctx, conversationId }))) return null;

  const position = await messagePosition({ ctx, conversationId, messageId: message.id });
  await upsertMessageRow({ ctx, conversationId, message, position });

  // A new message is activity: the list orders by `updated_at`.
  await ctx.run((db) => db.updateTable("ai_chats").set({ updated_at: ctx.clock.nowMs() }).where("id", "=", conversationId).execute());
  // Re-read only the written row, while still in the same transaction and conversation lock.
  const saved = await ctx.run(db => ownedMessages({ ctx, db, conversationId }).where('m.id', '=', message.id).executeTakeFirst());
  return saved ?? null;
}

/** Writes and projects one message inside the borrowed transaction; null for absent/foreign IDs. */
export function writeMessage({ ctx, conversationId, message }: { ctx: SqlStoreContext; conversationId: string; message: ChatMessage }): Promise<ChatMessage | null> {
  const m = withFolderReceipt({ message });
  return ctx.kernel.transaction(async () => {
    const saved = await writeMessageSteps({ ctx, conversationId, message: m });
    return saved ? ctx.toMessage(saved) : null;
  });
}
