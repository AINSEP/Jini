/**
 * @module ag-ui-approval-relay
 *
 * P6-T2.T step 4, admin client half. When an AG-UI segment ends with a standard confirmation
 * interrupt, the daemon run is still alive and parked on the existing approval card. This module
 * keeps that one logical turn busy across segments, routes the existing card's decision to a resume
 * of the same thread (fresh run id, the interrupted run as parent), and settles the turn once.
 *
 * Why the interrupt is read from the agent's own event stream (`observe`) rather than Jini's
 * `onLiveEvent` port: after a durable acceptance Jini drops every later segment frame before that
 * port is consulted (`ag-ui-transport.ts` `durableStartEvent`), because the checkpoint follower owns
 * the transcript. The interrupt is addressing data, not transcript, so it is tapped before that drop.
 *
 * Why-comments to keep: the pause is a one-use right to answer an already-running call; the
 * exchange id addresses a decision but cannot authenticate it (the server checks the owner from
 * the session); a normal segment close is not Stop.
 */
import type { RunAgentInput } from "@ag-ui/core";
import type { RunHandlers } from "../transport.js";
import type { AgUiRunClient } from "./ag-ui-transport.js";
import type { McpUiToolCallHandler } from "@jini-ai/protocol/mcp-ui";
import type { AgentEvent } from "@jini-ai/core/contracts/site/chat-core";

/** The card's exchange-id param, the wire name Jini's `SURFACE_EXCHANGE_ID_PARAM` defines in
 *  `@jini-ai/core`'s `surface-exchanges.ts`, which has no browser-safe export to import it from. */
const EXCHANGE_ID_PARAM = "__exchangeId";

/** The existing approval card's answer seam, as the dock's renderer composition sees it. */
export interface AgUiApprovalPoster {
  answersExchange(required: { exchangeId: string }, optional?: Record<string, never>): boolean;
  answer(required: { exchangeId: string; allow: boolean }, optional?: Record<string, never>): Promise<boolean>;
}

export interface AgUiApprovalRelay extends AgUiApprovalPoster {
  /** Wraps one logical turn's handlers; the result goes to every segment of that turn. */
  beginTurn(required: { threadId: string; handlers: RunHandlers; signal: AbortSignal }, optional?: Record<string, never>): RunHandlers;
  /** Every wire event of a segment on `threadId`, before the shared client sees it. */
  observe(required: { threadId: string; event: unknown; input: RunAgentInput }, optional?: Record<string, never>): void;
  bindRun(required: { threadId: string; runId: string }, optional?: Record<string, never>): void;
  /** Stop: drops the parked answer right and settles a turn whose last segment already ended.
   *  Returns the live resume segment's id, which the caller stops too. */
  release(required: { runId: string }, optional?: Record<string, never>): string | undefined;
}

export interface AgUiApprovalRelayPorts {
  resume: AgUiRunClient["resumeAgUiRun"];
  /** The server's one refusal for a resume it will not honor (expired, replayed or foreign). */
  copy: { expired: string; unsent: string };
  /** True once the shared client accepted `runId` as an owned durable run (follower owns output). */
  isAccepted(required: { runId: string }, optional: Record<string, never>): boolean;
}

interface ParkedInterrupt { readonly interruptId: string; readonly parentRunId: string; readonly exchangeId: string; claimed: boolean }

interface LogicalTurn {
  readonly threadId: string;
  readonly handlers: RunHandlers;
  readonly signal: AbortSignal;
  readonly carried: AgentEvent[];
  canonicalRunId?: string;
  pending?: ParkedInterrupt | undefined;
  heldDone: boolean;
  resumeRunId?: string;
  settled: boolean;
  refused: boolean;
}

/** Reads the standard confirmation interrupt the server ends an approval segment with. */
function readConfirmationInterrupt({ event }: { event: unknown }, _optional: Record<string, never> = {}): Omit<ParkedInterrupt, "claimed"> | undefined {
  const finished = event as { type?: unknown; runId?: unknown; outcome?: { type?: unknown; interrupts?: unknown } } | null;
  if (finished?.type !== "RUN_FINISHED" || finished.outcome?.type !== "interrupt" || typeof finished.runId !== "string") return undefined;
  const interrupts = Array.isArray(finished.outcome.interrupts) ? finished.outcome.interrupts as Array<{ id?: unknown; reason?: unknown; metadata?: { exchangeId?: unknown } }> : [];
  const first = interrupts.find((entry) => entry.reason === "confirmation" && typeof entry.id === "string" && typeof entry.metadata?.exchangeId === "string");
  return first ? { interruptId: first.id as string, parentRunId: finished.runId, exchangeId: first.metadata!.exchangeId as string } : undefined;
}

/** A resume failure in plain words: the server's 400 is always the expiry refusal, and no other
 *  failure detail (status lines, daemon text) is fit for the dock. */
function plainResumeFailure({ error, copy }: { error: unknown; copy: AgUiApprovalRelayPorts["copy"] }, _optional: Record<string, never> = {}): Error {
  for (let current = error; current instanceof Error; current = current.cause) {
    const status = (current as { status?: unknown }).status;
    if (status === 400 || /\bHTTP 400\b/.test(current.message)) return new Error(copy.expired);
  }
  return new Error(copy.unsent);
}

/** One final transcript for the whole logical turn. Each segment may report the parked run's usage
 *  so far; the last report is the run's, and summing them would count the first segment twice. */
function finalTranscript({ events }: { events: AgentEvent[] }, _optional: Record<string, never> = {}): AgentEvent[] {
  const lastUsage = events.map((event) => event.kind).lastIndexOf("usage");
  return events.filter((event, index) => event.kind !== "usage" || index === lastUsage);
}

// A durable turn's follower renders the resumed run from the checkpoint, so the resume segment's
// own frames would duplicate it; only its refusal is news, and that arrives as the rejection.
const DURABLE_RESUME_SINK = { onEvent: () => undefined, onError: () => undefined, onDone: () => undefined } as unknown as RunHandlers;

/** Posts the one resume a parked interrupt allows: same thread, the interrupted run as parent. */
async function resumeParked(
  { entry, allow, resume, handlers, refuse }: { entry: { turn: LogicalTurn; parked: ParkedInterrupt }; allow: boolean;
    resume: AgUiApprovalRelayPorts["resume"]; handlers: RunHandlers; refuse: (turn: LogicalTurn, error: unknown) => void },
  _optional: Record<string, never> = {},
): Promise<boolean> {
  // The pause is a one-use right: a second click on the same card must not post a second resume.
  if (entry.parked.claimed) return true;
  entry.parked.claimed = true;
  const { turn, parked } = entry;
  const decision: NonNullable<RunAgentInput["resume"]> = [{ interruptId: parked.interruptId, status: "resolved", payload: allow ? "allow" : "deny" }];
  try {
    const started = await resume({ input: { history: [], signal: turn.signal, conversationId: turn.threadId },
      handlers, threadId: turn.threadId, parentRunId: parked.parentRunId, resume: decision }, {});
    turn.resumeRunId = started.runId;
    return true;
  } catch (error) {
    refuse(turn, error);
    return false;
  }
}

/** The top-level segment's RUN_STARTED names the turn's canonical run; the first one wins.
 * @complexity O(1). */
function noteCanonicalRun({ turn, event, input }: { turn: LogicalTurn; event: unknown; input: RunAgentInput }, _optional: Record<string, never> = {}): void {
  const started = event as { type?: unknown; runId?: unknown };
  if (started?.type === "RUN_STARTED" && typeof started.runId === "string" && !input.parentRunId) turn.canonicalRunId ??= started.runId;
}

/** @complexity O(1). */
function releaseAnsweredPause({ turn, input }: { turn: LogicalTurn; input: RunAgentInput }, _optional: Record<string, never> = {}): void {
  // The resumed segment answers the claimed pause; from its first frame the turn waits on it.
  if (turn.pending?.claimed && input.parentRunId === turn.pending.parentRunId) turn.pending = undefined;
}

function segmentHandlersFor({ turn, durable, settle }: { turn: LogicalTurn; durable: (turn: LogicalTurn) => boolean; settle: (turn: LogicalTurn, final: AgentEvent[]) => void }, _optional: Record<string, never> = {}): RunHandlers {
  return ({ ...turn.handlers,
    onEvent: (event) => { if (!turn.settled) turn.handlers.onEvent(event); },
    onError: (error) => { if (!turn.settled) turn.handlers.onError(error); },
    // An interrupt segment end is neither completion nor failure: the run is parked, not over. A
    // durable turn's follower already outlives its segments, so only a delivery-only turn holds.
    onDone: (final) => {
      if (turn.settled) return;
      if (turn.pending && !durable(turn)) { turn.carried.push(...final); turn.heldDone = true; return; }
      settle(turn, final);
    } });
}

/** @complexity O(1) per callback; O(n) once at settle. */
export function createAgUiApprovalRelay({ ports }: { ports: AgUiApprovalRelayPorts }, _optional: Record<string, never> = {}): AgUiApprovalRelay {
  const turns = new Map<string, LogicalTurn>();
  const runs = new Map<string, LogicalTurn>();
  const exchanges = new Map<string, { turn: LogicalTurn; parked: ParkedInterrupt }>();
  const durable = (turn: LogicalTurn) => turn.canonicalRunId !== undefined && ports.isAccepted({ runId: turn.canonicalRunId }, {});
  const forget = (turn: LogicalTurn) => {
    for (const [exchangeId, entry] of exchanges) if (entry.turn === turn) exchanges.delete(exchangeId);
    turn.pending = undefined;
  };
  const settle = (turn: LogicalTurn, final: AgentEvent[]) => {
    if (turn.settled) return;
    turn.settled = true;
    forget(turn);
    if (turns.get(turn.threadId) === turn) turns.delete(turn.threadId);
    turn.handlers.onDone(finalTranscript({ events: [...turn.carried, ...final] }));
  };

  const refuse = (turn: LogicalTurn, error: unknown) => {
    turn.pending = undefined;
    if (turn.settled || turn.refused) return;
    turn.refused = true;
    turn.handlers.onError(plainResumeFailure({ error, copy: ports.copy }));
    if (turn.heldDone) settle(turn, []);
  };
  const answer = async ({ exchangeId, allow }: { exchangeId: string; allow: boolean }, _optional: Record<string, never> = {}): Promise<boolean> => {
    const entry = exchanges.get(exchangeId);
    return entry ? resumeParked({ entry, allow, resume: ports.resume, handlers: durable(entry.turn) ? DURABLE_RESUME_SINK : segmentHandlersFor({ turn: entry.turn, durable, settle }), refuse }) : false;
  };
  return {
    answersExchange: ({ exchangeId }) => exchanges.has(exchangeId),
    answer,
    beginTurn: ({ threadId, handlers, signal }) => {
      const turn: LogicalTurn = { threadId, handlers, signal, carried: [], heldDone: false, settled: false, refused: false };
      turns.set(threadId, turn);
      return segmentHandlersFor({ turn, durable, settle });
    },
    observe: ({ threadId, event, input }) => {
      const turn = turns.get(threadId);
      if (!turn || turn.settled) return;
      noteCanonicalRun({ turn, event, input }, {});
      releaseAnsweredPause({ turn, input }, {});
      const interrupt = readConfirmationInterrupt({ event });
      if (!interrupt) return;
      const parked: ParkedInterrupt = { ...interrupt, claimed: false };
      turn.pending = parked;
      exchanges.set(parked.exchangeId, { turn, parked });
    },
    bindRun: ({ threadId, runId }) => { const turn = turns.get(threadId); if (turn) runs.set(runId, turn); },
    release: ({ runId }) => {
      const turn = runs.get(runId);
      if (!turn) return undefined;
      runs.delete(runId);
      forget(turn);
      if (turn.heldDone) settle(turn, []);
      return turn.resumeRunId;
    },
  };
}

/**
 * The existing approval card's tool-call route during an AG-UI run. Only a decision whose exchange
 * id belongs to a live AG-UI interrupt becomes a resume; every other card (MCP-UI, typed answer)
 * keeps its own route, so this never redirects a card the interrupt did not name.
 * @complexity O(1).
 */
export function routeApprovalToolCall(
  { approvals, fallback, copy }: { approvals: AgUiApprovalPoster; fallback: McpUiToolCallHandler; copy: { sent: string; notSent: string } },
  _optional: Record<string, never> = {},
): McpUiToolCallHandler {
  return async (call) => {
    const exchangeId = call.arguments[EXCHANGE_ID_PARAM];
    if (typeof exchangeId !== "string" || !approvals.answersExchange({ exchangeId }, {})) return fallback(call);
    const sent = await approvals.answer({ exchangeId, allow: call.arguments.decision === "confirm" }, {});
    // The dock already shows the plain refusal once; the card only learns that nothing was sent.
    return { isError: !sent, content: [{ type: "text", text: sent ? copy.sent : copy.notSent }] };
  };
}
