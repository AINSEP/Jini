import { buildTranscript, latestUserPromptFromHistory } from "../transcript.js";
import type { ChatMessage } from "../messages.js";
import type { StartRunInput } from "../transport.js";

/**
 * How many trailing messages of a conversation go to the agent.
 *
 * A cap rather than none: each turn cold-boots a fresh subprocess and pays for its whole input, so
 * an uncapped transcript makes every message in a long chat more expensive than the last. 40 is
 * roughly 20 exchanges — beyond what a working session usually needs to stay coherent, and far
 * short of where input cost starts to dominate. `buildTranscript` separately truncates any single
 * oversized message, so this bounds the number of turns, not their size.
 */
const MAX_TRANSCRIPT_TURNS = 40;

/**
 * The prompt for one run: the whole conversation so far, not just the newest message.
 *
 * This used to send only the latest user turn, which is why the assistant appeared to have no
 * memory — ask it something, then ask a follow-up, and the second run had never seen the first.
 * That looked like a missing capability and was not: `ChatPane` hands the full history to every
 * `startRun`, and it was being discarded here, in the browser, before the request was even built.
 * Nothing server-side had to change.
 *
 * `buildTranscript` rather than a hand-rolled join, because flattening a transcript has more edges
 * than it first appears: it truncates any single oversized message, escapes `## user`/`## assistant`
 * inside message bodies so a user cannot forge a turn boundary by pasting one, summarizes persisted
 * artifacts instead of replaying them, and prepends a warning when prior-run telemetry shows the
 * context was already large. Every admin turn cold-boots a fresh CLI subprocess, so the transcript
 * IS the memory — and the same property makes an unbounded one expensive.
 *
 * Bounded deliberately: each run is billed, and an unbounded transcript grows the input cost of
 * every subsequent turn in a conversation that has no natural end. {@link MAX_TRANSCRIPT_TURNS}
 * keeps a long-running chat from silently becoming the most expensive thing in the product.
 * Failed turns are labeled outcomes so another agent can explain and recover from them.
 */
export function runPrompt({ history }: { history: StartRunInput["history"] }, _optional: Record<string, never> = {}): string {
  const recent = history.slice(-MAX_TRANSCRIPT_TURNS).map(message => {
    if (message.role !== 'assistant' || isAnsweredAssistantTurn(message)) return message;
    const detail = message.events?.filter(event => event.kind === 'status')
      .map(event => [event.label, event.detail].filter(Boolean).join(': ')).join('\n').slice(-4000);
    // Reserve space for the failure reason even when partial output fills the transcript cap.
    const outcome = [message.content.slice(0, 6000), detail].filter(Boolean).join('\n\n');
    return { ...message, content: `[${message.agentName ?? message.agentId ?? 'Assistant'} run ${message.runStatus}; not a completed answer]\n${outcome || 'No assistant reply was produced.'}` };
  });
  return buildTranscript({ history: recent });
}

/**
 * Whether an assistant message represents a turn the agent actually answered — the single
 * definition both {@link historyForTranscript} and {@link undeliveredUserPrompt} key off.
 *
 * `undefined` counts as answered: rows written before `ai_chat_messages.run_status` existed carry
 * no status at all, and treating those as unanswered would re-send the whole history of every
 * legacy conversation on its next turn. Every non-`succeeded` status counts as unanswered —
 * `failed` and `canceled` obviously, and `queued`/`running` because a run killed mid-flight (a
 * daemon respawn, see `daemon-supervisor.ts`) never reaches a terminal status at all and leaves
 * exactly such a row behind.
 *
 * Do not "simplify" this away by deleting the failed rows at the source instead. That was the first
 * shape proposed for this fix and it is the wrong trade: `run_status='failed'` was ALREADY the
 * explicit failed state, and the only thing missing was somewhere that skips it. The row's
 * `events_json` is the sole durable record of why a run died (exit code, signal, the CLI's own
 * stderr) once the daemon's in-memory event log is gone, and the pane renders it on reload — so
 * dropping the row trades a history bug for a forensics hole. The skip belongs here, on the read
 * side. The transcript's hidden-tool mode likewise filters only recovered tool failures and keeps
 * unrecovered failures behind a compact disclosure; it never deletes this durable evidence.
 * See {@link historyForTranscript} and `assistant-chats.ts`'s `persistableMessages`.
 */
function isAnsweredAssistantTurn(message: ChatMessage): boolean {
  return message.runStatus === undefined || message.runStatus === "succeeded";
}

/**
 * The history a transcript may be built from: every user turn, and only those assistant turns the
 * agent actually answered.
 *
 * Defect 3 of the 2026-09-11 chat-lifecycle repair. `ai_chat_messages` in
 * the investigated host's `chat.db` holds assistant rows with `run_status='failed'` and
 * `length(content)=0` — the durable trace of a run that died before writing a token. Replayed
 * through `buildTranscript` they become a `## assistant` block with nothing under it: the next run
 * is told the agent replied when what actually happened is that it died, and a failure the user can
 * see in the pane is laundered into an empty answer in the model's context.
 *
 * The rows themselves are deliberately NOT deleted, and this is the fix instead: their
 * `events_json` carries the only surviving record of why the run failed (exit code, signal, the
 * CLI's own stderr), the daemon's event log is in-memory and gone, and the pane renders that notice
 * on reload. Partial output from a failed run stays stored as partial output for the same reason —
 * it is visible to the user, and it is not the agent's answer, so it does not go back into a prompt.
 *
 * @param history - The pane's transcript, oldest first.
 * @returns A new array; the input is never mutated.
 * @complexity O(n) in history length, one pass, no allocation per message.
 */
export function historyForTranscript({ history }: { history: readonly ChatMessage[] }, _optional: Record<string, never> = {}): ChatMessage[] {
  return history.filter((message) => message.role !== "assistant" || isAnsweredAssistantTurn(message));
}

/**
 * Prepended when more than one user turn is being sent at once, so the agent is not told the user
 * typed all of it just now. Deliberately absent from the single-turn case — a note on every
 * ordinary message would be a standing lie in the prompt of every turn in every conversation.
 */
const UNDELIVERED_TURNS_NOTE =
  "[Some of the messages below never reached you: the run that should have answered them failed before it could. Treat them as the user's own words, in order, and answer all of them.]";

/**
 * The user text a run must carry when the agent carries its own conversation memory: every user
 * turn since the last one the agent actually answered, not only the newest.
 *
 * Defect 2 of the 2026-09-11 chat-lifecycle repair, and the half of it that was actually lossy. In
 * the investigated host's `chat.db` conversation `9289701c-…`, position 5's user text is present in
 * `ai_chat_messages` and absent from every agent-session transcript: the run meant to answer it
 * failed 140 ms after start, so no CLI ever read it — and because
 * {@link resolveLocalCliPrompt} sends only the NEWEST user turn to a resume-capable agent, no later
 * turn ever carried it either. The message was durable the whole time and still lost, permanently,
 * with nothing anywhere saying so.
 *
 * Re-delivering costs a duplicate whenever the CLI did read the prompt before dying, which the
 * agent can reconcile from its own session. Not re-delivering costs the user a message with no
 * trace. The two are not symmetric, so this errs toward the duplicate.
 *
 * @param history - The pane's transcript, oldest first.
 * @returns The prompt text — the bare newest turn in the ordinary case (the previous turn was
 *   answered), or the unanswered turns joined oldest-first behind {@link UNDELIVERED_TURNS_NOTE}.
 *   Falls back to the newest user turn when the history ends in an answered assistant turn and
 *   there is therefore nothing pending.
 * @complexity O(n) in history length — one forward scan for the boundary plus one slice/filter over
 *   the tail. A backwards scan with an early exit would be O(1) in practice but needs `break`, and
 *   `n` here is bounded by one conversation's transcript; this is not a hot path (once per turn).
 *   The result is capped at {@link MAX_TRANSCRIPT_TURNS} for the pathological case of a
 *   conversation whose every run has failed.
 */
export function undeliveredUserPrompt({ history }: { history: readonly ChatMessage[] }, _optional: Record<string, never> = {}): string {
  // `Array.prototype.findLastIndex` would say this in one call, but it is ES2023 and the
  // supported target is ES2022, so the index is accumulated instead.
  let lastAnsweredIndex = -1;
  history.forEach((message, position) => {
    if (message.role === "assistant" && isAnsweredAssistantTurn(message)) lastAnsweredIndex = position;
  });

  const pending = history
    .slice(lastAnsweredIndex + 1)
    .filter((message) => message.role === "user")
    .slice(-MAX_TRANSCRIPT_TURNS);

  if (pending.length === 0) return latestUserPromptFromHistory({ history: history as ChatMessage[] });
  const newest = pending[pending.length - 1] as ChatMessage;
  const newestText = newest.content.trim();
  const newestAttachmentRefs = JSON.stringify((newest.attachments ?? []).map((attachment) => attachment.path));
  // Collapse resends of the newest text with matching attachment refs: a retry is one request.
  const distinct = pending.filter((message, index) => index === pending.length - 1
    || message.content.trim() !== newestText
    || JSON.stringify((message.attachments ?? []).map((attachment) => attachment.path)) !== newestAttachmentRefs)
    .map((message) => message.content);
  if (distinct.length === 1) return distinct[0] as string;
  return `${UNDELIVERED_TURNS_NOTE}\n\n${distinct.join("\n\n")}`;
}

/** Send a resumed agent only its unseen conversation tail, retaining other agents' outcomes.
 * Legacy rows without agent identity retain the existing unanswered-user delivery contract.
 * @complexity O(n) to find the last answered turn; transcript rendering is capped at 40 turns.
 */
export function resolveLocalCliPrompt(
  { input, resumeCapableAgentIds }: { input: StartRunInput; resumeCapableAgentIds: ReadonlySet<string> | undefined },
  _optional: Record<string, never> = {},
): string {
  const carriesOwnMemory = input.agentId !== undefined && resumeCapableAgentIds?.has(input.agentId) === true;
  if (!carriesOwnMemory) return runPrompt({ history: input.history });
  let lastOwnAnswer = -1;
  input.history.forEach((message, index) => {
    if (message.role === 'assistant' && (!message.agentId || message.agentId === input.agentId) && isAnsweredAssistantTurn(message)) lastOwnAnswer = index;
  });
  const unseen = input.history.slice(lastOwnAnswer + 1);
  const crossedAgents = unseen.some(message => message.role === 'assistant' && message.agentId && message.agentId !== input.agentId);
  // BEHAVIOR CHANGE (2026-09-11, Defect 2): the resume-capable branch was `latestUserPrompt` — the
  // single newest user turn, on the assumption that everything before it is already inside the
  // CLI's own session. That assumption holds only for turns the agent actually answered; a turn
  // whose run died before the CLI read its prompt is in neither place, and nothing ever sent it
  // again. `undeliveredUserPrompt` returns the identical single string in the ordinary case and
  // differs only when there is genuinely something unanswered to catch up on.
  return crossedAgents ? runPrompt({ history: unseen }) : undeliveredUserPrompt({ history: input.history });
}


/** The newest `role: "user"` message in a history, or `undefined` when it has none.
 * @complexity O(n) in history length. */
export function newestUserMessage({ history }: { history: readonly ChatMessage[] }, _optional: Record<string, never>): ChatMessage | undefined {
  return [...history].reverse().find((message) => message.role === "user");
}
