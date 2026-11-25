/**
 * @module agent-bridge/frontend-invocation-handler
 *
 * Invocation and result handling for the frontend session bridge: replay suppression, routing a
 * relayed invocation to the chat pane or a local executor, and acknowledging its result. It owns
 * no connection state; the bridge injects the answer functions and the shared work registries.
 */
import type { ChatPaneAgentToolAction } from '../../react/features/chat-pane/types.js';
import type { FrontendSessionBridgeOptions } from './frontend-session-bridge.js';

/** How many settled invocation ids to remember for replay suppression. */
const EXECUTED_MEMORY = 256;

/** The three ways this surface answers a daemon invocation. */
export interface InvocationResponder {
  readonly respond: (invocationId: string, body: Record<string, unknown>) => Promise<void>;
  readonly respondSuccess: (invocationId: string, output: unknown) => Promise<void>;
  readonly respondError: (invocationId: string, message: string) => Promise<void>;
}

/** Everything one invocation needs from the bridge; none of it is owned here. */
export interface InvocationDeps {
  readonly options: FrontendSessionBridgeOptions;
  readonly responder: InvocationResponder;
  readonly pending: Map<string, AbortController>;
  readonly chatListeners: ReadonlySet<(action: ChatPaneAgentToolAction) => void>;
  /** Replaces the page work queue's tail; the bridge owns the queue so park can reset it. */
  readonly enqueuePage: (work: () => Promise<void>) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Freeze once, ask on the app's existing human-only channel, then use the same page executor.
 * The server pauses its execution deadline only after acknowledging the bounded human wait. */
async function servePage(
  { action, signal, options, respond }: { action: ChatPaneAgentToolAction; signal: AbortSignal; options: FrontendSessionBridgeOptions; respond: InvocationResponder['respond'] },
): Promise<unknown> {
  const input = options.preparePageInput ? options.preparePageInput({ action }) : structuredClone(action.input);
  const args = { capabilityId: action.capabilityId, input };
  if (options.pageApproval && !options.pageApproval.isDirect(args)) {
    await respond(action.invocationId, { phase: 'approval-pending' });
    signal.throwIfAborted();
    const answer = await options.pageApproval.request({ ...args, input: structuredClone(input), signal });
    signal.throwIfAborted();
    // Report the decision before effects, including decline/expiry; the server audits it.
    await respond(action.invocationId, { phase: 'execution-started', decision: answer.confirmed ? 'approved' : answer.reason });
    if (!answer.confirmed) return { executed: false, reason: answer.reason };
  }
  if (signal.aborted) return { executed: false, reason: 'abandoned' };
  return options.page!.execute(args, { signal });
}

/** Runs the page driver or the prefix-matched product executor for one non-chat invocation. */
async function executeLocally(
  { action, signal, options, respond }: { action: ChatPaneAgentToolAction; signal: AbortSignal; options: FrontendSessionBridgeOptions; respond: InvocationResponder['respond'] },
): Promise<unknown> {
  signal.throwIfAborted();
  if (options.page !== undefined && action.capabilityId.startsWith('page.')) {
    return servePage({ action, signal, options, respond });
  }
  const entry = Object.entries(options.executors ?? {})
    .find(([prefix]) => action.capabilityId.startsWith(prefix));
  if (entry === undefined) throw new Error(`nothing on this page serves "${action.capabilityId}"`);
  return entry[1](action.capabilityId, action.input);
}

async function acknowledge(
  { action, output, signal, options, respondSuccess }: { action: ChatPaneAgentToolAction; output: unknown; signal: AbortSignal; options: FrontendSessionBridgeOptions; respondSuccess: InvocationResponder['respondSuccess'] },
): Promise<void> {
  try {
    signal.throwIfAborted();
    const projected = await options.onBeforeResponse?.({ action, output });
    signal.throwIfAborted();
    const acceptedOutput = projected ?? output;
    await respondSuccess(action.invocationId, acceptedOutput);
    signal.throwIfAborted();
    await options.onAfterResponse?.({ action, output: acceptedOutput });
  } catch (error) { options.onError?.(error); }
}

/** Runs one non-chat invocation here and answers it. Chat ones go to the pane instead. */
async function serveLocally(
  { action, controller, deps }: { action: ChatPaneAgentToolAction; controller: AbortController; deps: InvocationDeps },
): Promise<void> {
  const { options, responder, pending } = deps;
  let output: unknown;
  try {
    output = await executeLocally({ action, signal: controller.signal, options, respond: responder.respond });
  } catch (error) {
    pending.delete(action.invocationId);
    if (controller.signal.aborted) return;
    await responder.respondError(action.invocationId, errorMessage(error)).catch(options.onError ?? (() => undefined));
    return;
  }
  await acknowledge({ action, output, signal: controller.signal, options, respondSuccess: responder.respondSuccess });
  pending.delete(action.invocationId);
}

function remember({ executed, invocationId }: { executed: Set<string>; invocationId: string }): void {
  executed.add(invocationId);
  if (executed.size > EXECUTED_MEMORY) {
    const oldest = executed.values().next().value;
    if (oldest !== undefined) executed.delete(oldest);
  }
}

/** Hands an accepted invocation to the pane's listeners or to a local abortable serve. */
function dispatchAccepted({ action, deps }: { action: ChatPaneAgentToolAction; deps: InvocationDeps }): void {
  if (action.capabilityId.startsWith('chat.')) {
    for (const listener of deps.chatListeners) listener(action);
    return;
  }
  const controller = new AbortController();
  deps.pending.set(action.invocationId, controller);
  const serve = () => serveLocally({ action, controller, deps });
  if (action.capabilityId.startsWith('page.')) {
    deps.enqueuePage(serve);
  } else void serve();
}

/** Builds the handler that runs one well-formed invocation: replay check, announcement, then serving. */
export function createInvocationHandler({ deps }: { deps: InvocationDeps }, _optional = {}): (action: ChatPaneAgentToolAction) => void {
  const { options, responder } = deps;
  /** Invocation ids already run here, so a stream reconnect cannot double-click a button. */
  const executed = new Set<string>();
  /** Runs one well-formed invocation: replay check, announcement, then pane or local serving. */
  return function handleInvocation(action) {
    // A redelivery after a dropped answer must not re-run the side effect.
    if (executed.has(action.invocationId)) {
      void responder.respondError(action.invocationId, 'already executed on this surface').catch(() => undefined);
      return;
    }
    if (options.capabilityIds && !options.capabilityIds.includes(action.capabilityId)) {
      void responder.respondError(action.invocationId, 'Capability unavailable').catch(() => undefined);
      return;
    }
    remember({ executed, invocationId: action.invocationId });
    options.onInvocation?.(action);
    dispatchAccepted({ action, deps });
  };
}
