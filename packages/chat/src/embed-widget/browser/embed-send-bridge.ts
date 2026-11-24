import type { ChatPaneAgentControlOptions } from '../../react/features/chat-pane/types.js';

/** One remote send request as an embedding page dispatches it on the widget's mount root. */
interface EmbedSendRequest { text: string; done: (error?: string) => void }

export interface InstallEmbedSendBridgeArgs {
  readonly root: HTMLElement;
  /** The mounted widget's own conversation owner; the bridge never sends on its own. */
  readonly send: (input: { text: string }, options?: Record<string, never>) => Promise<void>;
  /** CustomEvent name the embedding page dispatches on `root` (host-chosen). */
  readonly requestEventName: string;
  /** `postMessage` type announced to the parent frame once the listener is ready (host-chosen). */
  readonly readyMessageType: string;
  /** Host decision: only opted-in embeddings get a listener; ordinary visitors get none. */
  readonly enabled: boolean;
}

export interface EmbedSendBridgeOptions {
  /** Sentence reported to a request that arrives while another one is in flight. */
  readonly busyMessage?: string;
}

const DEFAULT_BUSY_MESSAGE = 'This pane is already replying.';

/**
 * Lets an embedding page drive a mounted widget through native events. Each request uses the
 * mounted widget's conversation owner; it never opens a parallel transport or edits its DOM.
 * One in-flight request per pane prevents a double-click from starting duplicate runs.
 * @complexity O(1) per request.
 */
export function installEmbedSendBridge(args: InstallEmbedSendBridgeArgs, _optional: EmbedSendBridgeOptions = {}): () => void {
  const { root, send, requestEventName, readyMessageType, enabled } = args;
  if (!enabled) return () => {};
  const busyMessage = _optional.busyMessage ?? DEFAULT_BUSY_MESSAGE;
  let busy = false;
  const listener = (event: Event) => {
    const request = (event as CustomEvent<EmbedSendRequest | null>).detail;
    if (!request || typeof request.text !== 'string' || typeof request.done !== 'function') return;
    if (busy) { request.done(busyMessage); return; }
    busy = true;
    root.dispatchEvent(new (root.ownerDocument.defaultView!.Event)('jini-chat-open'));
    void Promise.resolve().then(() => send({ text: request.text })).then(
      () => request.done(),
      (error: unknown) => request.done(error instanceof Error ? error.message : String(error)),
    ).finally(() => { busy = false; });
  };
  root.addEventListener(requestEventName, listener);
  root.dataset.compareReady = 'true';
  const view = root.ownerDocument.defaultView;
  view?.parent.postMessage({ type: readyMessageType }, view.location.origin);
  return () => { root.removeEventListener(requestEventName, listener); delete root.dataset.compareReady; };
}

export interface CreateEmbedSendAgentControlArgs extends Pick<InstallEmbedSendBridgeArgs, 'requestEventName' | 'readyMessageType'> {
  readonly root: HTMLElement | null;
  readonly enabled: boolean;
  /** Invocation id stamped on every relayed `chat.send_message` action (host-chosen). */
  readonly invocationId: string;
}

export interface EmbedSendAgentControlOptions extends EmbedSendBridgeOptions {
  /** Capability the relayed action targets; defaults to ChatPane's `chat.send_message`. */
  readonly capabilityId?: string;
  /** Rejection message for a send still in flight when the pane unmounts. */
  readonly unmountedMessage?: string;
}

/**
 * Adapts {@link installEmbedSendBridge} to ChatPane's opt-in agent-control bridge, so a React
 * widget reuses its existing send capability; ordinary visitors (`enabled: false`) omit it.
 * @complexity O(1) per relayed action.
 */
export function createEmbedSendAgentControl(
  args: CreateEmbedSendAgentControlArgs, _optional: EmbedSendAgentControlOptions = {},
): ChatPaneAgentControlOptions | undefined {
  const { root, enabled, invocationId, requestEventName, readyMessageType } = args;
  if (!root || !enabled) return undefined;
  const capabilityId = _optional.capabilityId ?? 'chat.send_message';
  const unmountedMessage = _optional.unmountedMessage ?? 'Embedded pane was unmounted.';
  let pending: { resolve: () => void; reject: (error: Error) => void } | null = null;
  return { enabled: true, bridgeAccess: {
    subscribe: onAction => {
      const dispose = installEmbedSendBridge({ root, enabled: true, requestEventName, readyMessageType, send: ({ text }) => new Promise<void>((resolve, reject) => {
        pending = { resolve, reject };
        onAction({ invocationId, capabilityId, input: { prompt: text } });
      }) }, _optional.busyMessage === undefined ? {} : { busyMessage: _optional.busyMessage });
      return () => {
        dispose();
        pending?.reject(new Error(unmountedMessage));
        pending = null;
      };
    },
    respondSuccess: async () => { pending?.resolve(); pending = null; },
    respondError: async (_id, message) => { pending?.reject(new Error(message)); pending = null; },
  } };
}
