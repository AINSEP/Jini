/**
 * @file Persisted conversation threads as a plain controller — no React. Owns which thread is open,
 * what's in it, and writing new turns back to the host's conversation store (an injected
 * {@link ConversationStorePort}, e.g. a local database over IPC), plus every race guard that keeps
 * those three consistent while loads, creates and saves settle out of order. `useStoredConversations`
 * (`hooks/useStoredConversations.hooks.ts`) is only the React binding around this; the logic, and
 * the reasoning behind each guard, lives here.
 *
 * Structurally mirrors `useAssistantChats` (`../../hooks/assistant-chats.ts`) — the same shape
 * solving the same problem — simplified for a local store call instead of a flaky HTTP one: no
 * write retry ladder, since a failed local write is not a transient network blip worth
 * re-attempting on a timer, just something to log and let the next delta re-queue.
 *
 * State is held here and read synchronously (`getState`), never from a rendered React value — the
 * successor of the hook's old `activeIdRef`, which mirrored `activeId` state and was written at the
 * point of decision (never from an effect): `onMessagesChange` is called from INSIDE `ChatPane`'s
 * own effect, a child component, and React runs a child's effects before its parent's in the same
 * commit — an effect mirroring `activeId` would still be reading the outgoing value the moment a
 * delta from the newly-mounted pane arrives. Same hazard `assistant-chats.ts`'s
 * `activeIdRef`/`commitActiveId` documents. Every guard below is likewise mutated BEFORE the state
 * it protects is published, so no subscriber ever observes new state alongside a stale guard.
 */
import type { ChatMessage } from '../../../core/messages.js';
import { persistableMessages } from '../../../core/assistant-client/messages.js';
import type {
  ConversationController,
  ConversationLog,
  ConversationState,
  ConversationStorePort,
  ConversationSummaryLike,
} from './types.js';

interface ControllerCore<S extends ConversationSummaryLike = ConversationSummaryLike> {
  readonly bridge: ConversationStorePort<S> | undefined;
  readonly log: ConversationLog;
  readonly onChange: ((state: ConversationState<S>) => void) | undefined;
  readonly listeners: Set<() => void>;
  state: ConversationState<S>;
  /** Message ids already saved, keyed by conversation — without this every delta would re-save the
   *  whole settled transcript, since the callback fires on each one and the settled prefix only grows. */
  readonly written: Map<string, Set<string>>;
  /** Guards `select`/`create` against a slower one resolving after a faster, later one already won. */
  switchSeq: number;
  /** A navigation intent owns the pane even before its load/create settles. */
  navigating: boolean;
  /** In-flight lazy conversation creation, so concurrent deltas before it resolves adopt ONE conversation, not many. */
  adopting: Promise<string | null> | null;
  /** Bumped whenever an in-flight adoption stops belonging to the pane that started it (a `select`/
   *  `create`/`remove` since). An adoption re-checks this before publishing `activeId`. */
  adoptionGen: number;
  /** Makes each fresh, nothing-selected pane key distinct — `paneKey: 'new'` alone would fail to
   *  remount a pane that had lazily adopted (and is now having that same conversation deleted). */
  paneNonce: number;
  /** Conversations this controller deleted. The store refuses writes to them, so a message the old
   *  pane settles before `remove`'s follow-up `select` lands is dropped with the thread it belonged to. */
  readonly deleted: Set<string>;
}

const INITIAL_STATE: ConversationState<never> = { conversations: [], activeId: null, paneKey: 'new', initialMessages: [] };

/**
 * Builds the controller. Nothing is read from the bridge until a method is called — the initial
 * list load is the caller's `refresh()`.
 * @param bridge the host's conversation store; `undefined` when the host has none (every action
 *   is then a no-op).
 * @param log where failures are reported; defaults to `console.error`, looked up at call time.
 * @param onChange called with each newly published state, before subscribers are notified.
 */
export function createConversationController<S extends ConversationSummaryLike = ConversationSummaryLike>(
  { bridge }: { bridge: ConversationStorePort<S> | undefined },
  { log = (...args: unknown[]) => console.error(...args), onChange }: {
    log?: ConversationLog;
    onChange?: (state: ConversationState<S>) => void;
  } = {},
): ConversationController<S> {
  const core: ControllerCore<S> = {
    bridge, log, onChange, listeners: new Set(), state: INITIAL_STATE, written: new Map(),
    switchSeq: 0, navigating: false, adopting: null, adoptionGen: 0, paneNonce: 0, deleted: new Set(),
  };
  return {
    getState: () => core.state,
    subscribe: ({ listener }) => subscribe({ core, listener }),
    refresh: () => refresh<S>(core),
    select: ({ id }) => select({ core, id }),
    create: () => create(core),
    remove: ({ id }) => remove({ core, id }),
    rename: ({ id, title }) => rename({ core, id, title }),
    onMessagesChange: ({ messages }) => onMessagesChange({ core, messages }),
  };
}

function subscribe<S extends ConversationSummaryLike>({ core, listener }: { core: ControllerCore<S>; listener: () => void }, _options: Record<string, never> = {}): () => void {
  core.listeners.add(listener);
  return () => {
    core.listeners.delete(listener);
  };
}

/** Replaces state immutably and tells everyone listening. */
function publish<S extends ConversationSummaryLike>({ core, patch }: { core: ControllerCore<S>; patch: Partial<ConversationState<S>> }, _options: Record<string, never> = {}): void {
  core.state = { ...core.state, ...patch };
  core.onChange?.(core.state);
  for (const listener of core.listeners) listener();
}

function resetAdoption<S extends ConversationSummaryLike>(core: ControllerCore<S>): void {
  core.adopting = null;
  core.adoptionGen += 1;
}

/** Invalidate pane adoption at navigation intent, retaining its promise for outgoing deltas.
 * @returns The latest navigation sequence. @complexity O(1), controller state only.
 */
function beginSwitch<S extends ConversationSummaryLike>(core: ControllerCore<S>, _options: Record<string, never> = {}): number {
  core.switchSeq += 1;
  core.adoptionGen += 1;
  core.navigating = true;
  return core.switchSeq;
}

function withConversation<S extends ConversationSummaryLike>(
  { core, conversation }: { core: ControllerCore<S>; conversation: S },
  _options: Record<string, never> = {},
): readonly S[] {
  return [conversation, ...core.state.conversations];
}

/**
 * Falls back to the list last published — which is what `remove` needs when its own `refresh()`
 * lands stale: the optimistic filter it just published is already in that list.
 */
async function refresh<S extends ConversationSummaryLike>(core: ControllerCore<S>): Promise<readonly S[]> {
  if (core.bridge === undefined) return core.state.conversations;
  try {
    // A list requested before deletion may finish afterwards. Tombstones govern every
    // publication, not only remove's own follow-up request.
    const list = (await core.bridge.listConversations()).filter(c => !core.deleted.has(c.id));
    publish({ core, patch: { conversations: list } });
    return list;
  } catch (err) {
    core.log('could not load conversations —', err);
    return core.state.conversations;
  }
}

function select<S extends ConversationSummaryLike>({ core, id }: { core: ControllerCore<S>; id: string }, _options: Record<string, never> = {}): void {
  const bridge = core.bridge;
  if (bridge === undefined || core.deleted.has(id)) return;
  const seq = beginSwitch(core);
  const commit = (messages: ChatMessage[]) => commitSelection({ core, id, seq, messages });
  void bridge
    .loadConversationMessages({ conversationId: id })
    .then(commit)
    // A failed load still switches, to an empty pane — leaving the user on the previous
    // conversation while the switcher already says otherwise is the worse of the two failures.
    .catch((err) => {
      core.log(`could not load conversation ${id} —`, err);
      commit([]);
    });
}

/**
 * Only `select` publishes id, transcript and written-ids together, in the order that keeps a
 * remount from ever showing an empty pane under a non-empty switcher entry.
 */
function commitSelection<S extends ConversationSummaryLike>(
  { core, id, seq, messages }: { core: ControllerCore<S>; id: string; seq: number; messages: ChatMessage[] },
  _options: Record<string, never> = {},
): void {
  // A slower load for a conversation the user has since navigated away from must not land.
  if (core.switchSeq !== seq) return;
  core.navigating = false;
  if (core.deleted.has(id)) return;
  core.written.set(id, new Set(messages.map((m) => m.id)));
  resetAdoption(core);
  // A deliberate switch is exactly when remounting the pane IS the intent.
  publish({ core, patch: { initialMessages: messages, activeId: id, paneKey: id } });
}

async function create<S extends ConversationSummaryLike>(core: ControllerCore<S>): Promise<void> {
  const bridge = core.bridge;
  if (bridge === undefined) return;
  // Claimed BEFORE the request and re-checked after, so a selection made after the click (while
  // the create is still in flight) wins rather than yanking the user back into a new, empty
  // pane the moment the slower create resolves.
  const seq = beginSwitch(core);
  let conversation: S;
  try { conversation = await bridge.createConversation(); }
  finally { if (core.switchSeq === seq) core.navigating = false; }
  if (core.deleted.has(conversation.id)) return;
  const conversations = withConversation({ core, conversation });
  if (core.switchSeq !== seq) {
    publish({ core, patch: { conversations } });
    return;
  }
  core.written.set(conversation.id, new Set());
  resetAdoption(core);
  publish({ core, patch: { conversations, activeId: conversation.id, initialMessages: [], paneKey: conversation.id } });
}

async function remove<S extends ConversationSummaryLike>({ core, id }: { core: ControllerCore<S>; id: string }, _options: Record<string, never> = {}): Promise<void> {
  const bridge = core.bridge;
  if (bridge === undefined) return;
  await bridge.deleteConversation({ id });
  core.written.delete(id);
  core.deleted.add(id);
  // The delete succeeded, so the thread leaves the switcher now — and is filtered out of what
  // `refresh` returns, whose failure fallback is the list still on screen (deleted row included).
  publish({ core, patch: { conversations: core.state.conversations.filter((c) => c.id !== id) } });
  const list = (await refresh(core)).filter((c) => c.id !== id);
  if (core.state.activeId !== id) return;
  const next = list[0]?.id ?? null;
  if (next === null) {
    landOnFreshPane(core);
    return;
  }
  // `select`, deliberately, not a raw publish of `activeId: next` — see `commitSelection`'s doc:
  // only `select` publishes id, transcript and written-ids together, in the order that keeps a
  // remount from ever showing an empty pane under a non-empty switcher entry.
  select({ core, id: next });
}

/** `remove` of the open thread when no other thread is left. */
function landOnFreshPane<S extends ConversationSummaryLike>(core: ControllerCore<S>): void {
  // Nothing left to land on. Bump the token so a switch already in flight cannot resurrect a
  // transcript into what is about to become an empty pane.
  core.switchSeq += 1;
  core.navigating = false;
  core.paneNonce += 1;
  // This is the one place `activeId` goes back to `null`, which is the only state that
  // re-enters the lazy-adoption path below — without this reset, the fresh pane would
  // inherit the deleted conversation's adoption and never persist again.
  resetAdoption(core);
  publish({ core, patch: { activeId: null, initialMessages: [], paneKey: `new-${core.paneNonce}` } });
}

async function rename<S extends ConversationSummaryLike>({ core, id, title }: { core: ControllerCore<S>; id: string; title: string }, _options: Record<string, never> = {}): Promise<void> {
  const bridge = core.bridge;
  if (bridge === undefined) return;
  // Optimistic: a rename that only appears after a round trip feels broken mid-edit.
  publish({ core, patch: { conversations: core.state.conversations.map((c) => (c.id === id ? { ...c, title } : c)) } });
  try {
    await bridge.renameConversation({ id, title });
  } catch (err) {
    core.log(`could not rename conversation ${id} —`, err);
  }
  void refresh(core);
}

/** Writes whatever in `messages` has settled and is not already stored, into `conversationId`. */
function flush<S extends ConversationSummaryLike>(
  { core, conversationId, messages }: { core: ControllerCore<S>; conversationId: string; messages: ChatMessage[] },
  _options: Record<string, never> = {},
): void {
  const bridge = core.bridge;
  if (bridge === undefined || core.deleted.has(conversationId)) return;
  // Always registered by now: every id that can reach here got its set when it became flushable
  // — `select`'s commit, `create` and lazy adoption each register one before `activeId` (or the
  // adoption's own flush) can name it — and `remove` drops a set only after marking the id
  // deleted, which the guard above returns on first. (This used to fall back to a fresh set,
  // which no path could reach.)
  const written = core.written.get(conversationId) as Set<string>;
  const pending = persistableMessages({ messages }, { includePendingUser: true }).filter((m) => !written.has(m.id));
  if (pending.length === 0) return;
  // Marked before the request resolves so a second `onMessagesChange` arriving mid-flight —
  // which it will, since deltas keep coming — does not queue the same message twice.
  for (const message of pending) written.add(message.id);
  for (const message of pending) saveMessage({ core, bridge, conversationId, message, written });
  // The first turn is what gives an untitled conversation its auto-generated title, and every
  // turn changes `messageCount`/`updatedAt` — re-read rather than patch, so the switcher stays
  // honest without this controller re-deriving the store's own title/ordering rules.
  void refresh(core);
}

function saveMessage<S extends ConversationSummaryLike>(
  { core, bridge, conversationId, message, written }: {
    core: ControllerCore<S>;
    bridge: ConversationStorePort<S>;
    conversationId: string;
    message: ChatMessage;
    written: Set<string>;
  },
  _options: Record<string, never> = {},
): void {
  void bridge.saveConversationMessage({ conversationId, message }).catch((err) => {
    core.log('could not persist a conversation message —', err);
    // Un-marked so a later delta gets one more chance, rather than a single failed write
    // silently dropping this message from the durable transcript forever.
    written.delete(message.id);
  });
}

/**
 * Fires once on `ChatPane` MOUNT with whatever `initialMessages` seeded it with, so a fresh pane
 * with nothing selected calls this with `[]` — `persistableMessages({ messages: [] }).length === 0` makes that a
 * no-op below, rather than mistaking a mount echo for new content to save.
 */
function onMessagesChange<S extends ConversationSummaryLike>({ core, messages }: { core: ControllerCore<S>; messages: ChatMessage[] }, _options: Record<string, never> = {}): void {
  const conversationId = core.state.activeId;
  if (conversationId !== null) {
    flush({ core, conversationId, messages });
    return;
  }

  // No conversation is active — the DEFAULT state, not an edge case: nothing selects one on
  // mount, so typing straight into a freshly opened chat (without first clicking "New" or
  // picking from history) lands here. Adopt one lazily, at the first moment there is actually
  // something worth saving, rather than littering the switcher with an empty row per app open.
  const bridge = core.bridge;
  if (bridge === undefined || persistableMessages({ messages }, { includePendingUser: true }).length === 0) return;

  const adoption = claimAdoption({ core, bridge });
  void adoption.then((id) => afterAdoption({ core, adoption, id, messages }));
}

function claimAdoption<S extends ConversationSummaryLike>({ core, bridge }: { core: ControllerCore<S>; bridge: ConversationStorePort<S> }, _options: Record<string, never> = {}): Promise<string | null> {
  const generation = core.adoptionGen;
  // Claimed only if nothing is already in flight, so two deltas arriving before the create
  // resolves await the SAME creation, not two. (Not `core.adopting ??= …` — Biome's
  // `noAssignInExpressions` refuses an assignment inside the expression that reads it back.)
  if (core.adopting === null) core.adopting = adoptConversation({ core, bridge, generation });
  return core.adopting;
}

function adoptConversation<S extends ConversationSummaryLike>(
  { core, bridge, generation }: { core: ControllerCore<S>; bridge: ConversationStorePort<S>; generation: number },
  _options: Record<string, never> = {},
): Promise<string | null> {
  return bridge
    .createConversation()
    .then((conversation) => {
      // The persisted row can be listed and deleted before its create acknowledgement arrives.
      if (core.deleted.has(conversation.id)) return null;
      core.written.set(conversation.id, new Set());
      // Superseded: the row exists and shows up in the switcher, but the pane that asked for
      // it is gone (the user switched away while this was in flight) — pointing
      // `activeId` at it now would route the NEXT pane's writes here. The flush in
      // `afterAdoption` still runs regardless: these messages came from the pane that asked for
      // this conversation, and dropping them would be exactly the data loss lazy adoption exists
      // to prevent.
      const adopt = core.adoptionGen === generation && !core.navigating ? { activeId: conversation.id } : {};
      publish({ core, patch: { conversations: withConversation({ core, conversation }), ...adopt } });
      return conversation.id;
    })
    .catch((err) => {
      core.log('could not create a conversation —', err);
      return null;
    });
}

function afterAdoption<S extends ConversationSummaryLike>(
  { core, adoption, id, messages }: { core: ControllerCore<S>; adoption: Promise<string | null>; id: string | null; messages: ChatMessage[] },
  _options: Record<string, never> = {},
): void {
  if (id === null) {
    // Cleared so a later turn can retry — leaving a rejected promise in place would wedge
    // persistence for the rest of the session.
    if (core.adopting === adoption) core.adopting = null;
    return;
  }
  flush({ core, conversationId: id, messages });
}
