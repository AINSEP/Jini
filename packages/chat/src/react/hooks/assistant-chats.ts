import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "../../core/messages.js";
import type { LastConversationStore } from "./last-conversation-store.js";
import { activeRunStub, messageWriteKey, persistableMessages } from "../../core/assistant-client/messages.js";
import type { AssistantConversation } from "../../core/assistant-client/messages.js";
import type { AssistantChatsPort, AssistantChatsClientPorts, AssistantChatsClient, UseAssistantChats } from "./assistant-chats-contracts.js";

/** Bind effects once; the returned hook captures its conversation port at mount.
 * Existing race guards and retry ordering remain in the original lexical lifecycle. */
export function createAssistantChatsClient({ ports }: { ports: AssistantChatsClientPorts }, _options: Record<string, never> = {}): AssistantChatsClient {
  /**
   * @file Owns the admin assistant's conversation state: which chat is open, what is in it, and what
   * has already been written.
   *
   * `ChatPane` is deliberately left as the uncontrolled component it already is — it takes
   * `initialMessages` and a `conversationId` and manages the live transcript itself. This hook only
   * supplies those two props and listens to `onMessagesChange`, which is why switching conversations
   * remounts the pane via its `key` rather than trying to push new messages into a running one.
   */
  /**
   * Backoff before each re-attempt of a failed message write — three retries over ~13s.
   *
   * The gap this closes: `flush` used to un-mark a failed message so it could be retried, and then
   * nothing ever retried it. Retrying is driven by `onMessagesChange`, which fires on deltas — and
   * the message most likely to fail is the *final* assistant reply, after which no further delta
   * arrives. A single transient 503 on that write plus a reload and the reply is gone from durable
   * history while still sitting on screen, which is the worst shape this failure can take: the user
   * has every reason to believe it was saved.
   *
   * Short and bounded on purpose. This is a foreground write for a transcript the user is looking
   * at, not a background job; if the server is still refusing after ~13s the honest outcome is to
   * stop and leave the id un-marked for a later delta, not to queue writes indefinitely.
   */
  const SAVE_RETRY_DELAYS_MS = [1_000, 3_000, 9_000] as const;

  /**
   * Whether a failed write is worth attempting again.
   *
   * A rejected `fetch` carries no status at all — offline, DNS, connection reset, the server
   * restarting mid-request — and is exactly the case retrying exists for. A response we actually
   * received is retryable when the server said "not now" (429, any 5xx) or "not there yet" (404).
   *
   * **404 belongs here, and leaving it out was a real bug.** It was excluded from `isPermanent` on
   * the correct reasoning that a 404 is reachable from a benign race — but it then matched neither
   * predicate, so `saveWithRetry` returned `"exhausted"` on the FIRST failure with no backoff at all,
   * `flush` un-marked it, and the next delta re-sent it immediately. That is the retry storm the
   * classification exists to prevent, just running at delta cadence instead of in a tight loop.
   * Treated as transient it consumes the bounded ladder and is only un-marked once, after ~13s.
   */
  function isTransient(error: unknown): boolean {
    const status = ports.statusOf({ error }, {});
    if (status !== undefined) {
      return status === 404 || status === 429 || status >= 500;
    }
    return true;
  }

  /**
   * Whether a failure means "this write can never succeed", which is a stronger and far more
   * dangerous claim than "this attempt failed" — a message classified permanent is kept marked as
   * written, so it is never retried and never persisted.
   *
   * Deliberately narrower than "not transient", and **404 is the exclusion that matters**. A 404 here
   * means the conversation was not found *for this caller*, which is genuinely reachable from a race
   * rather than from a malformed request: delete a conversation while a write is in flight and the
   * write 404s for a message that was perfectly valid. Treating that as permanent turns a lost race
   * into permanently lost data. Left retryable, it gets one more attempt from a later delta, and if
   * the conversation really is gone the pane has already switched away so no further delta names it.
   *
   * What remains permanent is the class that says the request itself is wrong — 400, 403, 422 — where
   * re-sending identical bytes is guaranteed to fail and retrying only produces a request storm.
   */
  function isPermanent(error: unknown): boolean {
    const status = ports.statusOf({ error }, {});
    if (status === undefined) return false;
    return status >= 400 && status < 500 && status !== 404 && status !== 429;
  }

  /**
   * The outcome of a write, at the granularity the caller has to act on.
   *
   * Four states rather than a boolean, because "failed" carries three different instructions.
   *
   * - `"exhausted"` — could plausibly succeed later, so un-mark the id and let a future delta retry.
   * - `"permanent"` — never will (400 on a malformed body, 403, 422). Un-marking THAT is actively
   *   harmful: every subsequent `onMessagesChange` re-queues it, so one dead message issues a doomed
   *   request on every delta for the rest of the session, and they accumulate as more fail alike.
   * - `"missing"` — exhausted specifically against a 404. Behaves like `"exhausted"` for marking, but
   *   is reported separately so `flush` can re-read the list: a write that keeps 404ing means the row
   *   this pane believes it is writing to may be gone, and the switcher should get the chance to
   *   reflect that rather than the pane grinding out doomed writes with nothing visible anywhere.
   */
  type SaveOutcome = "saved" | "exhausted" | "permanent" | "missing";

  /** One attempt's outcome: either the retry loop is DONE (a final {@link SaveOutcome} to return),
   *  or it should try again on the next iteration. A discriminated union rather than `SaveOutcome |
   *  null`/`undefined`, so "keep retrying" cannot be confused with any real outcome value — none of
   *  the four is a legitimate stand-in for "no verdict yet". */
  type AttemptResult = { done: true; outcome: SaveOutcome } | { done: false };

  /** The give-up classification for a transient failure that has run out of retries (out of attempts,
   *  or torn down mid-backoff) — a 404 specifically gets `"missing"` rather than `"exhausted"`; see
   *  `SaveOutcome`'s own doc for why that distinction is worth reporting separately. A top-level
   *  function rather than a closure inside {@link attemptSave} so its own `instanceof`/`&&` check is
   *  scored in its own (near-zero) scope instead of adding to that function's. */
  function giveUpOutcome(error: unknown): SaveOutcome {
    return ports.statusOf({ error }, {}) === 404 ? "missing" : "exhausted";
  }

  /**
   * Classifies one write failure and decides this attempt's outcome — the body of `attemptSave`'s
   * `catch` block, pulled out as its own function (2026-08-06, complexity pass, sixth pass) so its
   * four decisions are scored at nesting depth 0 instead of one level deep inside a `catch`. Cognitive
   * complexity charges extra for every structure nested inside another; a `catch` block is itself one
   * level of nesting, and every `if` these decisions need was paying that penalty on top of its own
   * cost. Moving the whole block to a sibling function resets the depth without changing which
   * decision runs when — `attemptSave`'s `catch` still runs synchronously into this on every failure.
   *
   * Each of the five outcomes {@link SaveOutcome}'s own doc names stays individually reachable and
   * individually distinguishable here, unchanged from the inline version: the one-line `"permanent"`
   * return, the one-line plain `"exhausted"` return, and the two give-up sites (out of attempts vs.
   * torn down mid-backoff) sharing {@link giveUpOutcome}'s classification. `"saved"` is handled in
   * `attemptSave`'s own `try` block, never reaching here.
   *
   * @param isDisposed checked before and after the sleep — an unmounted dock must not still be
   *   writing minutes later.
   */
  async function handleSaveFailure(
    error: unknown,
    conversationId: string,
    message: ChatMessage,
    attempt: number,
    isDisposed: () => boolean,
  ): Promise<AttemptResult> {
    if (isPermanent(error)) {
      // The one outcome that discards a message the user can still see on screen, so it does not get
      // to be silent. There is no error surface in the dock to route this to yet; a console error is
      // the honest minimum, and is what makes the drop findable rather than mysterious.
      ports.reportPermanent({
        conversationId,
        messageId: message.id,
        error,
      }, {});
      return { done: true, outcome: "permanent" };
    }
    if (!isTransient(error)) return { done: true, outcome: "exhausted" };
    const delay = SAVE_RETRY_DELAYS_MS[attempt];
    // Out of attempts, or torn down mid-backoff. Both are "might work later", not "never will" — but
    // a ladder spent entirely on 404s says something more specific, so report that.
    if (delay === undefined || isDisposed()) return { done: true, outcome: giveUpOutcome(error) };
    await ports.sleep({ delayMs: delay }, {});
    if (isDisposed()) return { done: true, outcome: giveUpOutcome(error) };
    return { done: false };
  }

  /**
   * One attempt at writing `message`: the try/catch body `saveWithRetry`'s loop used to hold inline,
   * pulled out (2026-08-06, complexity pass, fifth pass — an earlier pass at this same function left
   * it as a documented exemption; this extraction disproves that exemption, see below) as its own
   * async function so the loop itself only has to ask "is this attempt done, and with what?". The
   * failure-classification decisions themselves live in {@link handleSaveFailure}.
   *
   * @param isDisposed checked before and after the sleep — an unmounted dock must not still be
   *   writing minutes later. Never rejects, so `saveWithRetry`'s loop can await it unconditionally.
   */
  async function attemptSave(
    port: AssistantChatsPort,
    conversationId: string,
    message: ChatMessage,
    attempt: number,
    isDisposed: () => boolean,
  ): Promise<AttemptResult> {
    try {
      await port.saveMessage({ conversationId, message }, {});
      return { done: true, outcome: "saved" };
    } catch (error) {
      return handleSaveFailure(error, conversationId, message, attempt, isDisposed);
    }
  }

  /**
   * Writes one message, re-attempting transient failures on {@link SAVE_RETRY_DELAYS_MS} via
   * {@link attemptSave}.
   *
   * Never rejects, so a caller can treat the result as data rather than wrapping every call.
   */
  async function saveWithRetry(
    port: AssistantChatsPort,
    conversationId: string,
    message: ChatMessage,
    isDisposed: () => boolean,
  ): Promise<SaveOutcome> {
    for (let attempt = 0; ; attempt += 1) {
      const result = await attemptSave(port, conversationId, message, attempt, isDisposed);
      if (result.done) return result.outcome;
    }
  }

  /**
   * Decides what a settled batch of message-save outcomes means for `flush`'s bookkeeping: which
   * write keys (`messageWriteKey`) should be released back to `written` for a future delta to retry, and whether a
   * fresh conversation-list read is warranted. Pulled out of `flush`'s `Promise.all(...).then(...)`
   * continuation (2026-08-06, complexity pass) so this decision is directly assertable with a plain
   * array of outcomes — no port, no timers, no React state.
   *
   * `shouldRefresh` composes the original `if (some saved) … else if (isConversationStillActive &&
   * some missing) …` as one OR: the "saved" branch fires unconditionally, so ORing it with the
   * "missing" branch (itself gated on `isConversationStillActive`) reproduces the original
   * if/else-if exactly — the else-if only ever mattered when the first condition was already false.
   *
   * @param isConversationStillActive - `activeIdRef.current === conversationId` at the moment the
   *   batch settled — a `"missing"` outcome only warrants a refresh while the pane this write
   *   belonged to is still the one on screen; see `flush`'s own call site for why.
   */
  function summarizeFlushOutcomes(
    results: readonly { message: ChatMessage; outcome: SaveOutcome }[],
    isConversationStillActive: boolean,
  ): { idsToRelease: string[]; shouldRefresh: boolean } {
    const idsToRelease = results
      .filter((result) => result.outcome === "exhausted" || result.outcome === "missing")
      .map((result) => messageWriteKey({ message: result.message }, {}));
    const shouldRefresh =
      results.some((result) => result.outcome === "saved") ||
      (isConversationStillActive && results.some((result) => result.outcome === "missing"));
    return { idsToRelease, shouldRefresh };
  }

  /**
   * What the mount-time list read says about the conversation this browser last had open.
   *
   * - `"restore"` — it is still in this caller's list: land on it.
   * - `"forget"` — the list loaded and it is not there (deleted, or not this caller's): clear the
   *   remembered id so the next load does not keep chasing it, and stay on today's empty new chat.
   * - `"keep"` — nothing was remembered, or the list itself failed. A failed read says nothing
   *   about whether the conversation still exists, so a network blip must not erase the memory.
   *
   * @complexity Time O(n) in the number of listed conversations; space O(1).
   */
  function resolveRememberedConversation(
    { remembered, conversations, listFailed }: {
      remembered: string | null;
      conversations: readonly AssistantConversation[];
      listFailed: boolean;
    },
  ): "restore" | "forget" | "keep" {
    if (remembered === null || listFailed) return "keep";
    return conversations.some((conversation) => conversation.id === remembered) ? "restore" : "forget";
  }

  /**
   * Clears `store` only while it still holds `remembered`. A chat the operator opened while the list
   * read was in flight has already been written over it, and must not be forgotten in its place.
   * @complexity Time/space: O(1).
   */
  function forgetRemembered(store: LastConversationStore, remembered: string | null): void {
    if (store.read() === remembered) store.clear();
  }


  /**
   * @param port every call this hook makes off its own island. Injected rather than imported so a
   *   test can describe conversation state and write failures directly — see
   *   `createFakeAssistantChatsPort`. Referential stability is NOT required; see `portRef`.
   *
   * @complexityExemption (2026-08-06, complexity pass, second pass; bar raised to ≤9/≤9 same day,
   * exemption reconfirmed against the new bar) **Score: this hook's own lexical scope is 1
   * cyclomatic / ~0 cognitive under ESLint — every closure inside it is independently ≤9/≤9 too
   * (`select`'s inner `commit` is 2/1, `remove` is 6/3, `rename` is 4/2, `flush` is 4/2,
   * `ensureConversationId` is 3/1 — remeasured 2026-09-09, when adoption moved out of
   * `onMessagesChange` into `ensureConversationId`; see this file's own before/after table in the
   * session report for the original figures. `onMessagesChange` itself grew again on 2026-09-11 — the
   * reattach investigation's active-run stub write, `persistRunStub` — and is no longer independently
   * re-measured by hand here; `development/scripts/check-admin-complexity-drift.ts` is the actual gate
   * and reported zero new violations in this file after that change, which is the claim worth trusting
   * over a hand-counted number that will drift out of date again the next time this function changes).
   * What
   * is exempted here is a DIFFERENT, unmeasurable-by-me number: the dispatch brief's owner-tool score
   * of 19/24, which rolls every nested closure's branches into the hook's total. Bar: ≤9/≤9 on
   * whichever view is scored — ESLint's view already clears it; the owner-tool aggregate does not,
   * and I have no local tool that reproduces that aggregate to re-measure against the new bar.** This pass
   * already pulled every closure that could become a genuinely top-level PURE function out of hook
   * bodies across this scope (`saveWithRetry`, `summarizeFlushOutcomes`, `consumeByokStream`,
   * `buildLocalCliContextRef`, `loadExecutionConfig`'s ledger mappers, `upsertMessage`) — each of
   * those needed 0–2 plain parameters. `select`/`create`/`remove`/`rename`/`flush`/
   * `ensureConversationId`/`onMessagesChange` below do not fit that shape: each reads and writes between 3 and 9 of this
   * hook's own refs (`portRef`, `activeIdRef`, `writtenRef`, `switchSeqRef`, `adoptingRef`,
   * `adoptionGenRef`, `paneNonceRef`, `disposedRef`, `conversationsRef`, `listSeqRef`,
   * `pendingRenamesRef`, `renameVersionRef`) AND calls several of this hook's OTHER closures
   * (`resetAdoption`, `commitActiveId`, `refresh`, `select` itself), so extracting any one of them to
   * a top-level function means threading the rest through as an ad-hoc context parameter — turning a
   * compiler-checked lexical capture into a runtime object every call site has to assemble correctly
   * by hand. That is not a smaller change than what this pass already made elsewhere; it is a
   * different, far riskier one: every one of the ~12 numbered race conditions documented inline in
   * this file (see `portRef`'s, `commitActiveId`'s, `select`'s, and `remove`'s own doc comments) was
   * fixed by controlling EXACTLY when a specific ref is read relative to a specific React commit, and
   * the fix is stated in terms of "this closure, at this point in its own body" — re-deriving each of
   * those orderings through a threaded-params version, under this pass's own time budget, is how a
   * metric improves and one of those bugs quietly comes back. `use-settings-slice.hooks.ts`'s own
   * history is the cited precedent (brief §9): a previous attempt at exactly this kind of extraction
   * left that file's total unchanged (25 → 25). Declined for this pass; flagged to the coordinator
   * rather than attempted under time pressure. See this session's report for the full reasoning.
   */
  function useAssistantChats(
    port: AssistantChatsPort,
    { lastConversation }: {
      /**
       * Where this browser remembers the conversation the operator was last on, so a reload (or
       * leaving and coming back) reopens it instead of an empty new chat. Every `activeId` commit
       * writes it; the mount-time list read restores it — see {@link resolveRememberedConversation}.
       * Omitted, a reload opens an empty new chat as before. Captured once at mount, like `port`.
       */
      lastConversation?: LastConversationStore;
    } = {},
  ): UseAssistantChats {
    /**
     * The port, read through a ref so its identity is not a dependency of anything.
     *
     * The obvious alternative — listing `port` in each `useCallback` below — makes referential
     * stability a load-bearing, unenforceable contract on every caller. It is unenforceable because
     * the natural way to write the injection is the broken one:
     * `useChats={() => useAssistantChats(createFakeAssistantChatsPort())}` builds a new port per
     * render, so `refresh` changes identity, its effect re-runs, `setConversations` re-renders, and
     * it spins forever. Documenting "must be stable" only converts that into a trap with a footnote.
     *
     * A ref removes the contract instead of restating it: reads always see the latest port, and no
     * callback identity depends on it. Nothing here wants to *react* to a port swap — a new port does
     * not mean new conversation state — so there is no behaviour to lose.
     *
     * Captured ONCE at mount and never written again — not during render, and not in an effect.
     *
     * Both of the obvious spellings leak. A render-phase `portRef.current = port` publishes a value
     * from a render React may still discard (a `startTransition`, a suspended tree), so an event from
     * the still-committed old tree calls through a port that never committed. Moving it to an effect
     * fixes that and opens a different hole: React runs a CHILD's effects before its parent's in the
     * same commit, and `ChatPane` is a child of this hook's caller — so a delta forwarded from
     * `ChatPane`'s own effect, in the commit where `port` changed, reaches `flush` before this hook's
     * sync effect has run and reads the OUTGOING port. `useLayoutEffect` does not help: layout effects
     * are also child-first. The two spellings trade one gap for the other.
     *
     * So do not track the swap at all. Nothing here wants to react to one — a new port does not mean
     * new conversation state — and "permanently fixed at mount" is an honest contract where
     * "eventually consistent, with a window" is a latent bug. A caller that genuinely needs a
     * different backend should remount (key the calling component on whatever identifies it) rather
     * than swap the prop under a live instance.
     */
    const portRef = useRef(port);
    /** Captured once at mount for the same reason as {@link portRef}: a new store is a new identity,
     *  which means a remount, never a swap under a live instance. */
    const lastConversationRef = useRef(lastConversation);

    const [conversations, setConversations] = useState<AssistantConversation[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [paneKey, setPaneKey] = useState("new");
    const [initialMessages, setInitialMessages] = useState<ChatMessage[]>([]);
    /**
     * Write keys (message id plus run id, see `messageWriteKey`) already written, keyed by conversation.
     *
     * Without this, every `onMessagesChange` would re-`PUT` the entire settled transcript — the
     * callback fires on each delta, and the settled prefix only grows. Keyed by conversation so
     * switching away and back does not resurrect stale ids.
     */
    const writtenRef = useRef<Map<string, Set<string>>>(new Map());
    /** Dedup keys include scheduled writes; dispatch must await their actual completion. */
    const messagePendingRef = useRef<Map<string, Map<string, Promise<SaveOutcome>>>>(new Map());
    /**
     * Write keys (message id plus run id) whose active-run stub has already been written, keyed by conversation — see
     * {@link persistRunStub}'s own doc.
     *
     * Deliberately a SEPARATE map from {@link writtenRef}, not a shared one. `writtenRef` means "this
     * exact settled payload is durable (or a write for it is in flight)"; this one means only "the
     * early, non-terminal capture of this id's runId already went out". Sharing one set would make the
     * stub write (empty/partial content, `runStatus: 'queued'`/`'running'`) permanently satisfy
     * `flush`'s own dedup check for that id — the real terminal write, with the actual reply, would
     * then never go out at all.
     */
    const runStubWrittenRef = useRef<Map<string, Set<string>>>(new Map());
    /** Terminal writes wait for their earlier stub, so a slow stub cannot overwrite the answer. */
    const runStubPendingRef = useRef<Map<string, Map<string, Promise<void>>>>(new Map());
    const activeIdRef = useRef<string | null>(null);
    /**
     * Monotonic token identifying the most recent switch intent.
     *
     * `activeId` cannot serve as the staleness guard any more, because `select` now resolves the
     * transcript *before* publishing the id (see below) — at the moment a load returns, `activeId`
     * still names the previous conversation. Every switch-initiating path bumps this and then
     * verifies it is still the newest before committing.
     */
    const switchSeqRef = useRef(0);
    /** In-flight lazy conversation creation, so concurrent deltas adopt one conversation, not many. */
    const adoptingRef = useRef<Promise<string | null> | null>(null);
    /**
     * Bumped by {@link resetAdoption}. An adoption captures it and re-checks before publishing.
     *
     * `switchSeqRef` cannot do this job, and the version that tried was wrong in a way only a
     * specific ordering exposes: `select(B)` bumps the switch token *at call time*, so an
     * `onMessagesChange` arriving from the outgoing pane a moment later reads the ALREADY-bumped
     * value. B's load then commits (its own token still current), and the adoption resolves with a
     * token that still matches — so it published `activeId = A` while `paneKey` and `initialMessages`
     * were B's. The pane showed B's transcript and wrote it into A. Clearing `adoptingRef` in that
     * commit does not help either: it drops the reference, not the promise that is already running.
     *
     * So invalidation gets its own counter, bumped by the one function whose entire job is "this
     * adoption no longer belongs to anything".
     */
    const adoptionGenRef = useRef(0);
    /**
     * Makes each "fresh pane" key distinct.
     *
     * Resetting to a constant `"new"` is not enough: a pane that lazily adopted a conversation still
     * has `paneKey === "new"`, so deleting that conversation would set the key to the value it already
     * has, skip the remount, and leave the deleted chat's transcript sitting on screen.
     */
    const paneNonceRef = useRef(0);
    /** Stops a sleeping write retry from firing against a dock that is no longer mounted. */
    const disposedRef = useRef(false);

    useEffect(() => {
      // Reset on mount rather than only setting on unmount. StrictMode runs mount → unmount → mount
      // in development, so a cleanup-only version would latch `true` on the throwaway first pass and
      // leave every retry disabled for the real one — a bug that exists only in dev, which is the
      // worst place for it to hide.
      disposedRef.current = false;
      return () => {
        disposedRef.current = true;
      };
    }, []);

    /**
     * Bumped by every local mutation of the conversation list, so an older server snapshot cannot
     * overwrite it.
     *
     * The race without it: the mount `refresh()` is in flight and will resolve to `[]`. Before it
     * lands, the user creates (or lazily adopts) conversation A, which is inserted optimistically.
     * The stale response then arrives and replaces the list with `[]` — `activeId` still points at A,
     * but the switcher no longer lists it and the header falls back to the default title, so a real
     * conversation is invisible until some later write happens to refresh again.
     */
    const listSeqRef = useRef(0);
    /**
     * Titles whose PATCH is still in flight, by conversation id, each tagged with the rename that
     * queued it. Applied over every list read until that rename settles — see `refresh`.
     *
     * The version tag is what lets a settling rename clear only its OWN entry. A plain `delete(id)`
     * would drop a second, newer rename of the same conversation that queued while the first was in
     * flight, reopening the exact window this exists to close.
     */
    const pendingRenamesRef = useRef<Map<string, { version: number; title: string }>>(new Map());
    const renameVersionRef = useRef(0);
    /**
     * Mirrors the last `conversations` state this hook actually committed.
     *
     * The one consumer is `remove()`'s fallback, for exactly the case its own `refresh()` comes back
     * stale (a faster, concurrent mutation resolved first and is already reflected in state). Reading
     * `conversations` itself is not an option: the closure `remove` was built from can be arbitrarily
     * many renders behind by the time its `await`s resolve, and adding it as a dependency would just
     * reintroduce the identity churn `portRef`/`activeIdRef` exist to avoid.
     *
     * A plain `useEffect` is the right tool here, unlike for `portRef`/`activeIdRef` above: those had
     * to be current for a delta `ChatPane` — a CHILD — forwards inside the very commit that changed
     * them, and child effects run before parent effects, so an effect always lagged by exactly the
     * commit that mattered. `remove()`'s fallback is read from inside an already-`await`ed
     * continuation, at least one microtask after any mutation that would have updated it — well after
     * this hook's own effects for that commit have flushed. There is no same-commit reader to race.
     */
    const conversationsRef = useRef<AssistantConversation[]>([]);
    useEffect(() => {
      conversationsRef.current = conversations;
    }, [conversations]);

    /**
     * Re-reads the list, and reports whether the snapshot was still current when it arrived.
     *
     * The `fresh` flag is not decoration. An earlier version returned the list unconditionally with a
     * comment claiming `remove` needed the server's view regardless — which handed `remove` exactly
     * the snapshot this function had just decided was too stale to render: conversation A is active,
     * `remove(A)` starts a list read whose response still contains C, C is deleted meanwhile and a
     * newer refresh completes, then A's older response arrives, is correctly refused by
     * `setConversations`, and is still handed back. `remove` routes to C, so `activeId` lands on a
     * conversation that no longer exists and every subsequent message is written at a dead row.
     */
    const refresh = useCallback(async () => {
      const seq = ++listSeqRef.current;
      // `null` marks a failed read, so the mount-time restore can tell "not listed" from "no list".
      const read = await portRef.current.listConversations({}, {}).catch(() => null);
      const listed = read ?? [];
      /*
       * A rename whose PATCH has not settled wins over whatever the server just said.
       *
       * `markListMutated` cannot cover this, and assuming it did was the bug: that counter answers
       * "did a response from BEFORE my write land after it?", and says nothing about a read that
       * STARTS after the optimistic update but reaches a server which has not applied the PATCH yet.
       * Such a read is legitimately `fresh`, so it wrote the old title straight over the new one —
       * rename a conversation, let any unrelated activity trigger a refresh (a message save completing
       * elsewhere is enough), and the title visibly reverted until the rename's own trailing refresh
       * corrected it.
       */
      const pending = pendingRenamesRef.current;
      const conversations =
        pending.size === 0
          ? listed
          : listed.map((conversation) => {
              const rename = pending.get(conversation.id);
              return rename
                ? { ...conversation, title: rename.title, titleSource: "manual" as const }
                : conversation;
            });
      const fresh = listSeqRef.current === seq;
      // Not written to state when superseded: a local insert that landed while this was in flight is
      // strictly newer than this snapshot.
      if (fresh) setConversations(conversations);
      return { conversations, fresh, failed: read === null };
    }, []);

    /** Records a local list mutation, invalidating any `refresh` already in flight. */
    const markListMutated = useCallback(() => {
      listSeqRef.current += 1;
    }, []);

    /**
     * Discards any lazy adoption belonging to a pane that is about to be replaced.
     *
     * `adoptingRef` is scoped to exactly one pane — it names the conversation *that* pane adopted —
     * and every path that re-keys the pane has to clear it. The path that did not was a real fault:
     * delete your only conversation and `activeId` returns to `null`, which routes the next message
     * down the lazy-adoption branch, where `??=` found the previous pane's already-resolved promise
     * still naming the conversation that had just been deleted. The messages were `PUT` at a row that
     * no longer existed (404, silently), `activeId` was never set again, and no new conversation was
     * ever created — so the dock persisted nothing at all for the rest of the session. That is the
     * same user-visible symptom lazy adoption was introduced to fix, reachable by a different route.
     */
    /**
     * Sets `activeId` and its mirror ref together. Nothing may call `setActiveId` directly.
     *
     * The ref exists because `onMessagesChange` and `remove` have to know where writes go *now*, not
     * as of the render they closed over. It used to be kept current by a render-phase
     * `activeIdRef.current = activeId`, which is the same hazard the `portRef` comment above rejects:
     * a render React later discards has already published its id, and a delta from the still-
     * committed tree then routes a message into a conversation that was never actually selected.
     *
     * An effect is the usual remedy and is wrong here too — child effects run before parent effects,
     * so `ChatPane` can forward a delta before the sync effect runs, and the ref lags by a commit at
     * the exact moment it is being read. Writing both together at the point of decision avoids both:
     * every call site below is an event handler or a promise continuation, never a render, so the ref
     * is published only when the change is real and is never behind the state.
     */
    const commitActiveId = useCallback((id: string | null) => {
      activeIdRef.current = id;
      setActiveId(id);
      // The single point every active-conversation change passes through — select, create, lazy
      // adoption, and delete's landing — so the remembered id can never lag what is on screen.
      if (id === null) lastConversationRef.current?.clear();
      else lastConversationRef.current?.write(id);
    }, []);

    const resetAdoption = useCallback(() => {
      adoptingRef.current = null;
      // The half that actually stops an already-running adoption from publishing — see
      // `adoptionGenRef`. Dropping the reference alone only prevents *reuse*.
      adoptionGenRef.current += 1;
    }, []);

    /**
     * Publishes `activeId` and `initialMessages` in one commit, and only once the transcript is in
     * hand.
     *
     * Setting `activeId` first is what the obvious version does, and it is wrong in a way that is
     * invisible in tests: `activeId` is `ChatPane`'s `key`, so assigning it remounts the pane
     * *immediately*, while `initialMessages` still holds the conversation being navigated away from.
     * `ChatPane` reads `initialMessages` at mount only, so the fresh transcript — arriving a tick
     * later — was silently discarded and the pane displayed the previous chat's messages under the
     * new chat's title.
     *
     * The display fault was the mild half. The pane then reported that stale transcript through
     * `onMessagesChange`, and because `writtenRef` for the newly selected conversation was still
     * empty, every one of those messages was queued as an unsaved message *belonging to the new
     * conversation*. Observed live: selecting an empty chat fired four `PUT`s carrying the previous
     * chat's messages. They 404'd only because those message ids already existed under their real
     * conversation — an accident of the primary key, not a safeguard. Seeding `writtenRef` in the
     * same commit as the id is what actually closes that hole.
     *
     * React batches both setters (and the ref write precedes them), so the pane remounts exactly
     * once, already knowing what it holds and what has been persisted.
     */
    const select = useCallback(
      (id: string) => {
        const seq = ++switchSeqRef.current;
        const commit = (messages: ChatMessage[]) => {
          // A slower load for a conversation the user has since navigated away from must not land.
          if (switchSeqRef.current !== seq) return;
          writtenRef.current.set(id, new Set(messages.map(message => messageWriteKey({ message }, {}))));
          setInitialMessages(messages);
          commitActiveId(id);
          // A user-initiated switch is exactly when remounting the pane IS the intent.
          setPaneKey(id);
          resetAdoption();
        };
        void portRef.current
          .loadMessages({ conversationId: id }, {})
          .then(commit)
          // A failed load still switches, to an empty pane: leaving the user on the previous
          // conversation while its title says otherwise is the worse of the two failures.
          .catch(() => commit([]));
      },
      // `commitActiveId` added: it's a `useCallback([], ...)`-wrapped setter (see its own
      // declaration above), stable for the component's lifetime — no-op addition, not a suppression.
      [resetAdoption, commitActiveId],
    );

    /**
     * The mount-time list read, which also reopens the conversation this browser was last on.
     *
     * Declared after `select` because it calls it — moved here from beside `refresh` for that
     * reason only; the read itself is unchanged.
     *
     * The restore is skipped if the operator has already acted (switched, created, or started typing
     * into the empty pane, which adopts a conversation) before the list arrived: their own action is
     * newer intent than a memory from the previous page load. `switchSeqRef` covers select/create,
     * `activeIdRef`/`adoptingRef` cover lazy adoption. Under StrictMode's double mount the first
     * restore's `select` bumps `switchSeqRef`, so the second one stands down rather than loading twice.
     */
    useEffect(() => {
      const store = lastConversationRef.current;
      if (!store) {
        void refresh();
        return;
      }
      const remembered = store.read();
      const intentAtMount = switchSeqRef.current;
      void refresh().then(({ conversations, failed }) => {
        const decision = resolveRememberedConversation({ remembered, conversations, listFailed: failed });
        if (decision === "forget") forgetRemembered(store, remembered);
        const untouched = switchSeqRef.current === intentAtMount && activeIdRef.current === null && adoptingRef.current === null;
        if (decision === "restore" && untouched) select(remembered as string);
      });
    }, [refresh, select]);

    const create = useCallback(async () => {
      /*
       * The token is claimed BEFORE the request, and re-checked after.
       *
       * Claiming it after `createConversation()` resolved made "New" the winner of every race it
       * happened to finish last: click New, change your mind, pick chat B from the list, watch B load —
       * and then the earlier POST returns and yanks you into an empty new chat. Bumping up front
       * registers the intent at the moment of the click; re-checking means a selection made *after*
       * the click still wins, which is the ordering a user expects.
       *
       * The conversation row is still created either way. That is deliberate — it exists server-side,
       * and abandoning it silently would be worse than leaving an empty chat in the list.
       */
      const seq = ++switchSeqRef.current;
      const conversation = await portRef.current.createConversation({}, {});
      // Both branches insert locally, so both have to invalidate an in-flight `refresh` — otherwise a
      // list snapshot taken before this POST lands overwrites the row that was just added.
      markListMutated();
      if (switchSeqRef.current !== seq) {
        // Superseded: surface the new row in the list, but do not steal the user's current view.
        setConversations((current) => [conversation, ...current]);
        return;
      }
      setConversations((current) => [conversation, ...current]);
      commitActiveId(conversation.id);
      setInitialMessages([]);
      setPaneKey(conversation.id);
      writtenRef.current.set(conversation.id, new Set());
      resetAdoption();
      // `commitActiveId` added: stable `useCallback([], ...)` wrapper, see `select`'s identical note.
    }, [markListMutated, resetAdoption, commitActiveId]);

    const remove = useCallback(
      async (id: string) => {
        await portRef.current.deleteConversation({ id }, {});
        writtenRef.current.delete(id);
        const snapshot = await refresh();
        if (activeIdRef.current !== id) return;
        /*
         * A stale snapshot must not be trusted for routing: if this list read landed superseded (the
         * user deleted something else while it was in flight), it can still name a conversation that
         * has since been deleted, and routing there would strand `activeId` on a row no fresh list
         * will ever contain again — `select`'s `.catch(() => commit([]))` even dresses that up as a
         * successful switch to an empty pane.
         *
         * `fresh` is exactly the signal for that, and the earlier gap was checking it for nothing:
         * this used `snapshot.conversations` regardless of `fresh`. Falling back to `conversationsRef`
         * — mirroring the last state this hook actually committed, kept current by the effect above —
         * instead of an unguarded stale read closes it: by the time this snapshot is judged stale,
         * whatever concurrent mutation outraced it has already had its own `refresh()` commit, which
         * is what "stale" means here. `id` is filtered out regardless, so the row just deleted can
         * never be the landing spot even from the fallback.
         */
        const remaining = (snapshot.fresh ? snapshot.conversations : conversationsRef.current).filter(
          (conversation) => conversation.id !== id,
        );
        // Land on the next most recent chat rather than an empty pane with no way back.
        const next = remaining[0]?.id ?? null;
        if (!next) {
          // Nothing left to land on. Bump the token so a switch still in flight cannot resurrect a
          // transcript into the now-empty pane.
          switchSeqRef.current += 1;
          commitActiveId(null);
          setInitialMessages([]);
          paneNonceRef.current += 1;
          setPaneKey(`new-${paneNonceRef.current}`);
          // The branch `resetAdoption` exists for: this is the one place `activeId` goes back to
          // `null`, which is the only state that re-enters the lazy-adoption path. Without this the
          // fresh pane inherits the deleted conversation's adoption and never persists again.
          resetAdoption();
          return;
        }
        /*
         * `select` and ONLY `select` — deliberately no `setActiveId(next)` first.
         *
         * Setting the id here looks harmless and is not: `activeId` is `ChatPane`'s `key`, so it
         * remounts the pane immediately with `initialMessages` still empty, and then `select`'s own
         * commit sets `activeId` to the value it ALREADY has. The key never changes again, so the pane
         * is never remounted, and `ChatPane` seeds `initialMessages` at mount only — nothing resets it
         * on a prop change. The empty transcript is therefore permanent, not a flicker: deleting the
         * active chat landed on the next one showing no history at all, and the next prompt was sent
         * without it as context. `select` alone publishes id, transcript and written-ids in one commit.
         */
        select(next);
      },
      // `commitActiveId` added (used a few lines above, in the "nothing left to land on" branch):
      // stable `useCallback([], ...)` wrapper, see `select`'s identical note.
      [refresh, resetAdoption, select, commitActiveId],
    );

    const rename = useCallback(
      async (id: string, title: string) => {
        // Optimistic: a rename that only appears after a round-trip feels broken during the edit.
        // `markListMutated` for the same reason `create` needs it — this is a local write to the
        // list, so a refresh already in flight is now older than it. Without the mark, that older
        // response lands and the title visibly reverts to its previous value until the refresh below
        // corrects it a moment later.
        markListMutated();
        // Held until the PATCH settles, so any refresh landing in between re-applies this title
        // instead of trusting a server read that has not caught up yet.
        const version = ++renameVersionRef.current;
        pendingRenamesRef.current.set(id, { version, title });
        setConversations((current) =>
          current.map((c) => (c.id === id ? { ...c, title, titleSource: "manual" as const } : c)),
        );
        try {
          await portRef.current.renameConversation({ id, title }, {});
        } catch {
          // Swallowed as before — the trailing refresh shows whatever the server actually has, which
          // is the correct outcome for a failed rename too.
        } finally {
          // Only if no NEWER rename of this conversation has queued behind us.
          if (pendingRenamesRef.current.get(id)?.version === version) {
            pendingRenamesRef.current.delete(id);
          }
        }
        void refresh();
      },
      [markListMutated, refresh],
    );

    const saveTrackedMessage = useCallback(({ conversationId, message }: { conversationId: string; message: ChatMessage }, _optional = {}): Promise<SaveOutcome> => {
      const pending = messagePendingRef.current.get(conversationId) ?? new Map<string, Promise<SaveOutcome>>();
      messagePendingRef.current.set(conversationId, pending);
      const key = messageWriteKey({ message }, {});
      const existing = pending.get(key);
      if (existing) return existing;
      const write = (async () => {
        await runStubPendingRef.current.get(conversationId)?.get(key);
        return saveWithRetry(portRef.current, conversationId, message, () => disposedRef.current);
      })();
      pending.set(key, write);
      void write.then(() => {
        pending.delete(key);
        if (pending.size === 0) messagePendingRef.current.delete(conversationId);
      });
      return write;
    }, []);

    /** Writes whatever in `messages` has settled and is not already stored, into `conversationId`. */
    const flush = useCallback(
      (conversationId: string, messages: ChatMessage[]) => {
        const written = writtenRef.current.get(conversationId) ?? new Set<string>();
        writtenRef.current.set(conversationId, written);

        // Keyed by message id AND run id (see `messageWriteKey`), so a retry's new run is saved too.
        const pending = persistableMessages({ messages }, {}).filter((m) => !written.has(messageWriteKey({ message: m }, {})));
        if (pending.length === 0) return;

        // Marked before the request resolves so a second `onMessagesChange` arriving mid-flight —
        // which it will, since deltas keep coming — does not queue the same message twice.
        for (const message of pending) written.add(messageWriteKey({ message }, {}));

        void Promise.all(
          pending.map(async (message) => {
            return {
              message,
              outcome: await saveTrackedMessage({ conversationId, message }, {}),
            };
          }),
        ).then((results) => {
          /*
           * Un-marked ONLY when the write could plausibly succeed later.
           *
           * Un-marking on any failure — which this did — turns a permanent error into a permanent
           * load: the id goes back in the queue, the next `onMessagesChange` re-sends it, it fails
           * identically, and it is un-marked again. One 400 therefore issues a doomed request on
           * every subsequent delta for the rest of the session, and they accumulate as more messages
           * fail the same way. `saveWithRetry` has already spent its attempts by this point, so
           * "exhausted" is the only outcome where another try is worth queueing at all.
           *
           * `some`, not "all succeeded": one message failing must not suppress the list refresh for
           * the others. The first turn is what gives an untitled chat its name server-side, and
           * `messageCount` changes on every turn, so the list needs re-reading rather than patching.
           * A write that spent its whole ladder on 404s means this conversation may no longer exist —
           * re-read so the switcher stops showing a row the server has already forgotten, rather than
           * leaving the pane to grind out doomed writes with nothing visible anywhere in the UI.
           * See {@link summarizeFlushOutcomes} for the decision itself.
           */
          const { idsToRelease, shouldRefresh } = summarizeFlushOutcomes(
            results,
            activeIdRef.current === conversationId,
          );
          for (const id of idsToRelease) written.delete(id);
          if (shouldRefresh) void refresh();
        });
      },
      [refresh, saveTrackedMessage],
    );

    /**
     * Writes ONE user turn durably, right now, and reports nothing back but completion.
     *
     * Defect 2 of the 2026-09-11 chat-lifecycle repair. Until this existed, the only writer of a user
     * turn was {@link flush} — driven asynchronously off `onMessagesChange` deltas, with no ordering
     * relationship at all to `assistant-transport.ts`'s `POST /api/runs`. The two are not atomic: a
     * run could be (and was) dispatched while the message it was dispatched for had not been written
     * anywhere, so a failure in that window left the user's words in a browser tab and nowhere else.
     * `startRun` awaits this first, including any PUT already scheduled by `flush`. Acceptance also
     * persists the exact user payload with its stub, covering exhausted browser writes and tab loss.
     *
     * Shares `writtenRef` with `flush` deliberately — that is what makes the two writers cooperate
     * rather than duplicate. The id is marked before the request for the same reason `flush` marks
     * before its own resolves (a delta arriving mid-flight must not queue the same message again),
     * and released again on a failure `saveWithRetry` has already given up on, so `flush` still gets
     * its chance rather than the message being silently recorded as stored.
     *
     * @param conversationId - The conversation the turn belongs to. Supplied by the caller (which has
     *   just resolved it through {@link ensureConversationId}) rather than read from `activeIdRef`,
     *   so a run and its message can never land in two different conversations.
     * @param message - The exact `ChatMessage` being sent. Its `id` is the idempotency key:
     *   `saveMessage` PUTs to `/messages/<id>`, so writing the same message twice is one row.
     * @returns Nothing, always — never rejects. A caller that cannot make the turn durable must still
     *   be able to send it.
     * @complexity O(1) plus one PUT and its retry ladder.
     */
    const persistUserTurn = useCallback(async (conversationId: string, message: ChatMessage): Promise<void> => {
      const written = writtenRef.current.get(conversationId) ?? new Set<string>();
      writtenRef.current.set(conversationId, written);
      const key = messageWriteKey({ message }, {});
      // A new chat's first delta often reaches flush before transport reaches this method. The
      // dedup bit then means "scheduled", not "committed"; wait on the same PUT before dispatch.
      const pending = messagePendingRef.current.get(conversationId)?.get(key);
      if (pending) { await pending; return; }
      if (written.has(key)) return;
      written.add(key);

      const outcome = await saveTrackedMessage({ conversationId, message }, {});
      // Same rule `summarizeFlushOutcomes` applies to a settled batch, for the same reason: only an
      // outcome that could plausibly succeed later is worth handing back to `flush`. Re-queueing a
      // permanent failure would make every later delta re-send a doomed request.
      if (outcome !== "saved") written.delete(key);
    }, [saveTrackedMessage]);

    /**
     * Writes the ONE extra durable row a future reattach needs: a non-terminal assistant message's
     * `runId`, captured the moment it appears — see `assistant-chats.ts`'s {@link activeRunStub} for
     * why this is not already covered by {@link flush}.
     *
     * Deliberately best-effort and silent on a PERMANENT failure, unlike {@link persistUserTurn}: a
     * lost stub write only means a future reattach has nothing to find for this run, the same
     * degraded-but-safe outcome as today (nothing reattaches yet regardless — see the 2026-09-11
     * investigation this exists for). It must never surface as a chat-breaking error over what is, at
     * worst, a missed optimization. A TRANSIENT failure (503, a dropped connection) is left for the
     * next delta to retry for free: `id` is released so a later call with the same message id tries
     * again, exactly like {@link persistUserTurn}'s own release-on-failure.
     *
     * No retry ladder of its own (unlike `persistUserTurn`'s `saveWithRetry`): the run is still
     * streaming, so another `onMessagesChange` delta — and therefore another chance — arrives on its
     * own within moments. A run that ends before any further delta fires has nothing left worth
     * reattaching to anyway.
     *
     * Daemon acceptance now closes that former gap before dispatch. This best-effort path remains
     * only for request-bound BYOK/AG-UI; browser daemon stubs cannot own durable attempt state.
     * @complexity O(1) plus at most one `PUT`.
     */
    const persistRunStub = useCallback((conversationId: string, message: ChatMessage): void => {
      // Daemon acceptance commits the stub before dispatch; browser snapshots cannot own it.
      if (message.runId && !ports.requestRunPrefixes.some(prefix => message.runId!.startsWith(prefix))) return;
      const written = runStubWrittenRef.current.get(conversationId) ?? new Set<string>();
      runStubWrittenRef.current.set(conversationId, written);
      // Per run, not per message id: a retry reuses the id with a new run (see `messageWriteKey`).
      const key = messageWriteKey({ message }, {});
      if (written.has(key)) return;
      // This run's final result is already saved. A retry resets the message to `queued` while it still
      // carries the OLD run id; writing that would put a stale stub over the saved answer.
      if (writtenRef.current.get(conversationId)?.has(key)) return;
      written.add(key);
      const pending = runStubPendingRef.current.get(conversationId) ?? new Map<string, Promise<void>>();
      runStubPendingRef.current.set(conversationId, pending);
      const write = portRef.current.saveMessage({ conversationId, message }, {}).catch(() => {
        written.delete(key);
      }).finally(() => {
        pending.delete(key);
        if (pending.size === 0) runStubPendingRef.current.delete(conversationId);
      });
      pending.set(key, write);
    }, []);

    /**
     * This pane's conversation id, adopting one if that is what it takes — the single owner of lazy
     * adoption, awaited by {@link onMessagesChange} below and by `assistant-transport.ts`'s `startRun`
     * (via `AssistantDock`'s `useAssistantTransport`).
     *
     * `startRun` is the reason this is exposed rather than staying inline in `onMessagesChange`.
     * Adoption used to be reachable ONLY from a message delta, and `@jini-ai/chat`'s
     * `useChatPane.sendPrompt` freezes `runContext(...)` into the run's context object BEFORE it calls
     * `conversation.sendMessage(...)` — the very call that produces that first delta. So on turn 1 the
     * run was always dispatched with no `conversationId`, `agent-daemon-server.ts`'s `onStarted` skipped
     * its whole session-capture subscription (`if (conversationId !== undefined)`), and the agent-CLI
     * session id turn 2 needed to resume was never stored. Turn 2 then started cold while the client,
     * trusting that resume, had sent only the bare latest user message: the conversation's history was
     * gone, silently, at exactly the turn-1→turn-2 boundary of every chat.
     *
     * `setActiveId` WITHOUT `setPaneKey`: the pane may be mid-run and is keyed on `paneKey`, so leaving
     * that alone is what keeps this invisible to the user. Re-keying here would remount the pane and
     * destroy the reply currently streaming into it.
     *
     * @returns The conversation id writes and runs for this pane belong to, or `null` when creation
     *   failed. Never rejects — a caller that cannot get an id (`startRun`) must still be able to send
     *   the turn: one run with no resumable session is a far smaller loss than a run that never happens.
     * @complexity O(1) plus at most one `POST /conversations`, shared across concurrent callers.
     */
    const ensureConversationId = useCallback((): Promise<string | null> => {
      const active = activeIdRef.current;
      if (active) return Promise.resolve(active);

      /*
       * The adoption generation is READ here, and `resetAdoption` is the only thing that bumps it.
       *
       * Deliberately NOT `switchSeqRef`. That token is bumped at the *call* of `select`/`create`,
       * so an adoption starting after the click reads the already-bumped value, matches it when the
       * adoption resolves, and publishes `activeId` into a pane that has since been re-keyed to
       * someone else's transcript. `adoptionGenRef` moves with the commit rather than the intent,
       * which is the thing this actually needs to be later than.
       */
      const generation = adoptionGenRef.current;
      // `??=` so a run start and the deltas racing it await ONE creation, not two — otherwise a single
      // turn splits across two conversations, the run filed under one and the messages under the other.
      const adoption = (adoptingRef.current ??= portRef.current
        .createConversation({}, {})
        .then((conversation) => {
          markListMutated();
          setConversations((current) => [conversation, ...current]);
          writtenRef.current.set(conversation.id, new Set());
          // Superseded: the row exists and shows up in the list, but the pane that asked for it is
          // gone, so pointing `activeId` at it would send the NEXT pane's writes here. The caller's
          // own follow-up still runs either way — those messages came from the pane that asked for
          // this conversation, and dropping them would be the data loss adoption exists to prevent.
          if (adoptionGenRef.current === generation) commitActiveId(conversation.id);
          return conversation.id;
        })
        .catch(() => null));

      void adoption.then((id) => {
        /*
         * Cleared so a later turn can retry; keeping a rejected promise would wedge persistence for
         * the rest of the session.
         *
         * Guarded on identity, because a bare `adoptingRef.current = null` clears whatever is there
         * NOW, which need not be this promise. A stale adoption rejecting late would wipe a newer one
         * that is still in flight, and the next delta would start a third — two conversations created
         * for one turn, with the same messages flushed into both and whichever resolved last taking
         * `activeId`.
         */
        if (!id && adoptingRef.current === adoption) adoptingRef.current = null;
      });

      return adoption;
    }, [markListMutated, commitActiveId]);

    const onMessagesChange = useCallback(
      (messages: ChatMessage[]) => {
        // Computed once up front, independent of which branch below actually runs — both need it, and
        // it is O(1) (last element only, see `activeRunStub`'s own doc), so there is no cost to paying
        // it on every delta even on the branch that turns out not to use it.
        const stub = activeRunStub({ messages }, {});
        const conversationId = activeIdRef.current;
        if (conversationId) {
          if (stub) persistRunStub(conversationId, stub);
          flush(conversationId, messages);
          return;
        }

        /*
         * No conversation is active — and this is the DEFAULT state, not an edge case. Nothing selects
         * a conversation on mount, so opening the admin and typing straight into the dock (without
         * first clicking "New" or picking from history) landed here, where the old code simply
         * returned. The run worked on screen and neither turn was ever stored: the entire conversation
         * vanished on reload, silently, on the most common path through the feature.
         *
         * So adopt one lazily, at the first moment there is actually something to save. Created on
         * demand rather than on mount, because a row per admin page-load would litter the switcher with
         * empty conversations. `startRun` now usually gets here first (see {@link ensureConversationId}),
         * in which case `??=` makes this await that same creation rather than starting a second.
         */
        if (persistableMessages({ messages }, {}).length === 0 && !stub) return;

        void ensureConversationId().then((id) => {
          if (!id) return;
          if (stub) persistRunStub(id, stub);
          flush(id, messages);
        });
      },
      // Adoption itself now lives in `ensureConversationId` (stable `useCallback`, see its own doc),
      // so `markListMutated`/`commitActiveId` are no longer read here.
      [flush, ensureConversationId, persistRunStub],
    );

    // Boundary adapters keep the hook's stable action identities and lexical race guards intact.
    const actions = useMemo(() => ({
      select: ({ id }: { id: string }, _options: Record<string, never> = {}) => select(id),
      create: (_required: Record<string, never>, _options: Record<string, never> = {}) => create(),
      remove: ({ id }: { id: string }, _options: Record<string, never> = {}) => remove(id),
      rename: ({ id, title }: { id: string; title: string }, _options: Record<string, never> = {}) => rename(id, title),
      onMessagesChange: ({ messages }: { messages: ChatMessage[] }, _options: Record<string, never> = {}) => onMessagesChange(messages),
      ensureConversationId: (_required: Record<string, never>, _options: Record<string, never> = {}) => ensureConversationId(),
      persistUserTurn: ({ conversationId, message }: { conversationId: string; message: ChatMessage }, _options: Record<string, never> = {}) => persistUserTurn(conversationId, message),
    }), [select, create, remove, rename, onMessagesChange, ensureConversationId, persistUserTurn]);
    return { conversations, activeId, paneKey, initialMessages, ...actions };
  }

  return {
    giveUpOutcome: ({ error }: { error: unknown }, _options: Record<string, never> = {}) => giveUpOutcome(error),
    handleSaveFailure: ({ error, conversationId, message, attempt, isDisposed }: { error: unknown; conversationId: string; message: ChatMessage; attempt: number; isDisposed: () => boolean }, _options: Record<string, never> = {}) => handleSaveFailure(error, conversationId, message, attempt, isDisposed),
    attemptSave: ({ port, conversationId, message, attempt, isDisposed }: { port: AssistantChatsPort; conversationId: string; message: ChatMessage; attempt: number; isDisposed: () => boolean }, _options: Record<string, never> = {}) => attemptSave(port, conversationId, message, attempt, isDisposed),
    summarizeFlushOutcomes: ({ results, isConversationStillActive }: { results: Parameters<typeof summarizeFlushOutcomes>[0]; isConversationStillActive: boolean }, _options: Record<string, never> = {}) => summarizeFlushOutcomes(results, isConversationStillActive),
    resolveRememberedConversation: (required: Parameters<typeof resolveRememberedConversation>[0], _options: Record<string, never> = {}) => resolveRememberedConversation(required),
    useAssistantChats: ({ port }: { port: AssistantChatsPort }, options: { lastConversation?: LastConversationStore } = {}) => useAssistantChats(port, options),
  };
}
