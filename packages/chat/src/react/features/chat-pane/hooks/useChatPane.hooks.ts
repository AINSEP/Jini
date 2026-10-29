import { acceptedInputEvent, acceptedInputUserEvent, projectAcceptedInputEvents, type AcceptedChatInput } from '../../../../core/accepted-input.js';
import type { UserTextRedaction, UserTextRedactionOptions } from '../../../../core/user-text-redaction.js';
import { useUserTextGuard } from '../../../hooks/useUserTextGuard.js';
import { isAwaitingAnswer } from '../../../../core/run-activity.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  appendQueuedTurn,
  describeChatPaneSendBlocker,
  findAwaitedTypedAnswerId,
  findChatPaneSendBlocker,
  findMidRunMessageRunId,
  isChatPaneQueueableBlocker,
  resolveChatPaneSelection,
  type ChatPaneSendBlocker,
} from '../rules.js';
import type {
  ChatPaneActivity,
  ChatPaneAgent,
  ChatPaneAttachmentUploadOptions,
  ChatPaneAgentSelection,
  ChatPaneRunContext,
  ChatPaneRunContextInput,
  ChatPaneWorkingDirectoryAccess,
  DeliverMidRunMessage,
  DeliverTypedAnswer,
  MidRunMessageDelivery,
  TypedAnswerDelivery,
  TypedAnswerNotice,
} from '../types.js';
import type { ChatAttachment, ChatMessage } from '@jini-ai/chat';
import type { ComposerHistoryStoragePort } from '../../../../core/composer-history.js';
import type { ChatTransport, RunContext } from '@jini-ai/chat';
import { definedProps } from '../../../util/defined-props.js';
import { cacheAttachmentPreviewSource } from '../../../hooks/attachment-preview-cache.js';
import {
  readCachedAttachmentBatchId,
  writeCachedAttachmentBatchId,
} from '../../../hooks/composer-draft-cache.js';
import { useComposer, type UseComposerResult } from '../../../hooks/useComposer.js';
import {
  useConversation,
  type UseConversationResult,
} from '../../../hooks/useConversation.js';
import {
  useChatPaneWorkingDirectory,
  type UseChatPaneWorkingDirectoryResult,
} from './useChatPaneWorkingDirectory.hooks.js';

export interface UseChatPaneOptions extends UserTextRedactionOptions {
  transport: ChatTransport;
  agents: readonly ChatPaneAgent[];
  initialMessages?: ChatMessage[];
  refreshSignal?: import('../../../hooks/useConversation.js').UseConversationOptions['refreshSignal'];
  conversationId?: string | null;
  initialSelection?: ChatPaneAgentSelection;
  selection?: ChatPaneAgentSelection;
  onSelectionChange?: (selection: ChatPaneAgentSelection) => void;
  runContext?: ChatPaneRunContext;
  initialDraft?: string;
  composerHistoryScope?: string;
  composerHistoryStorage?: ComposerHistoryStoragePort;
  /** Recall retention; defaults to 100. */
  composerHistoryCap?: number;
  /** Forwarded verbatim to `useComposer`; see `validateAttachments` there for the contract. */
  validateAttachments?: (attachments: readonly ChatAttachment[]) => Promise<readonly ChatAttachment[]>;
  uploadAttachments?: (
    files: File[],
    options?: ChatPaneAttachmentUploadOptions,
  ) => Promise<ChatAttachment[]>;
  onActivityChange?: (activity: ChatPaneActivity) => void;
  onMessagesChange?: (messages: ChatMessage[]) => void;
  workingDirectory?: string | null;
  initialWorkingDirectory?: string | null;
  onChangeWorkingDirectory?: (workingDirectory: string | null) => void;
  workingDirectoryAccess?: ChatPaneWorkingDirectoryAccess;
  /**
   * Whether a configured BYOK/API turn should bypass the CLI-selection blocker below — the
   * caller's resolved {@link isChatPaneApiModeConfigured}. Omitted (or `false`) keeps today's
   * behavior: no selected agent always blocks sending.
   */
  apiModeConfigured?: boolean;
  /** See `ChatPaneProps.deliverTypedAnswer`. Omitted keeps today's queue-while-streaming behavior. */
  deliverTypedAnswer?: DeliverTypedAnswer;
  /** See `ChatPaneProps.deliverMidRunMessage`. Omitted keeps today's queue-while-streaming behavior. */
  deliverMidRunMessage?: DeliverMidRunMessage;
}

export interface UseChatPaneResult extends UseChatPaneWorkingDirectoryResult {
  /** Show a localized non-secret notice when a paste was removed. */
  secretRedacted: boolean;
  conversation: UseConversationResult;
  composer: UseComposerResult;
  selection: ChatPaneAgentSelection;
  selectedAgent: ChatPaneAgent | undefined;
  /**
   * The runtime inventory this pane is choosing from.
   *
   * Exposed so a caller can tell whether a selection *would* be honored before making it.
   * {@link setSelection} normalizes an unknown or unavailable agent to the first available one —
   * right for a picker, which must not break when a runtime disappears, and wrong for a
   * programmatic caller, which would otherwise be told its choice succeeded while a different
   * runtime was selected.
   */
  agents: readonly ChatPaneAgent[];
  activity: ChatPaneActivity;
  canSend: boolean;
  /**
   * Why a send would be refused, or `null` when the pane is ready. `canSend` additionally requires
   * a submittable composer; a caller supplying its own prompt should gate on this instead.
   */
  sendBlocker: ChatPaneSendBlocker | null;
  isUploadingAttachments: boolean;
  attachmentError: Error | null;
  setSelection: (selection: ChatPaneAgentSelection) => void;
  addAttachments: (files: File[]) => Promise<void>;
  send: () => Promise<void>;
  /**
   * Sends `prompt` through the same guarded path as the composer's `send()` — same blocker checks,
   * staged attachments, composer reset, attachment-batch rotation, and `onActivityChange('queued')`.
   * Exists so non-composer callers (agent control) cannot drift into a weaker send.
   *
   * @throws If {@link UseChatPaneResult.sendBlocker} is non-null, or `prompt` is blank. `send()`
   * pre-checks and never triggers this; agent-driven callers get a describable refusal instead of a
   * silent no-op.
   */
  sendPrompt: (prompt: string) => Promise<void>;
  /**
   * Sends the newest refused composer send again (see `conversation.sendError`). When that text is
   * back in the composer it goes out from there like {@link send}; when something new was typed
   * since, the refused text goes out on its own and the composer keeps the new typing.
   */
  retrySend: () => Promise<void>;
  /**
   * The prompt waiting for the in-flight run to finish, or `null` when nothing is queued. Exposed
   * so the pane can SHOW it — a queued turn that is invisible is indistinguishable from one that
   * was silently swallowed.
   */
  queuedPrompt: string | null;
  /** Individual queued messages, in send order, with their own staged files. */
  queuedMessages: readonly AcceptedChatInput[];
  /** Drops only the named queued message. */
  cancelQueuedMessage: (input: { id: string }, options?: {}) => void;
  /** Drops the queued prompt without ever sending it. */
  cancelQueued: () => void;
  /**
   * Delivery failure for the last typed answer, or `null`. Failures retain the draft; a definitive
   * not-pending refusal queues one ordinary message instead. Cleared by the next send and `reset()`.
   */
  typedAnswerNotice: TypedAnswerNotice | null;
  /**
   * Sends the composer draft as an ordinary next turn (queued behind a running run, as {@link send}
   * does), bypassing typed-answer routing.
   */
  sendAsNewMessage: () => Promise<void>;
  /**
   * Cancels the run in flight and sends the composer draft as soon as it stops — the modifier-key
   * counterpart to {@link send}, which queues behind the run instead of ending it. Implemented as
   * queue-then-cancel rather than cancel-then-send so both paths share one flush, and so a cancel
   * that never lands cannot strand the prompt.
   */
  interruptSend: () => void;
  reset: () => void;
}

/**
 * A queued message. Every path into the queue (`enqueueTurn`) records the files it took from the
 * composer, even when there were none, so a queued input's `attachments` is always present.
 */
type QueuedChatInput = AcceptedChatInput & { attachments: ChatAttachment[]; liveMessageId?: string };

/** Filter during render so a consumed receipt followed by end in the same batch cannot flush twice.
 * Legacy host receipts can replace optimistic IDs; the accepted-input owner retains their aliases.
 * @complexity O(e + q) time and space for receipt events and locally queued inputs.
 */
function unconsumedQueuedInputs({ inputs, messages }: { inputs: QueuedChatInput[]; messages: readonly ChatMessage[] }): QueuedChatInput[] {
  const consumed = new Set<string>();
  for (const message of messages) {
    for (const event of projectAcceptedInputEvents({ events: message.events ?? [] })) {
      const receipt = acceptedInputEvent({ event });
      if (receipt?.data.deliveryState !== 'consumed') continue;
      recordConsumedInputs({ receipt: receipt.data, consumed });
    }
  }
  return inputs.filter(input => !consumed.has(input.liveMessageId ?? input.id));
}

function recordConsumedInputs({ receipt, consumed }: { receipt: AcceptedChatInput & { inputs?: AcceptedChatInput[] }; consumed: Set<string> }): void {
  for (const input of [receipt, ...(receipt.inputs ?? [])]) {
    consumed.add(input.id);
    for (const alias of input.aliases ?? []) consumed.add(alias);
  }
}

/** The conversation copies run events onto its messages one effect after streaming stops, so a
 * consumed receipt can still be missing from the transcript when the send blocker clears. A
 * live-accepted copy therefore waits until the run's own message reaches a terminal status. */
function awaitingRunReceipts({ inputs, messages }: { inputs: QueuedChatInput[]; messages: readonly ChatMessage[] }): boolean {
  if (!inputs.some(input => input.liveMessageId !== undefined)) return false;
  const status = messages.at(-1)?.runStatus;
  return status === 'queued' || status === 'running';
}

/** The stand-in prompt for a turn that carries only attachments. */
const ATTACHMENTS_ONLY_PROMPT = 'Review the attached file(s).';

/**
 * The prompt a composer-driven send would carry: the trimmed draft, or a stand-in when only
 * attachments are staged. Module scope so `send()` and `interruptSend()` cannot drift apart on
 * what counts as sendable.
 */
function composerPrompt(composer: UseComposerResult): string {
  return composer.draft.trim()
    || (composer.attachments.length > 0 ? ATTACHMENTS_ONLY_PROMPT : '');
}

/** History hydration can replace a controller without an edit. Compare the accepted empty draft
 * and staged files so holding Enter cannot requeue an attachment-only submission on that render. */
function isRepeatedComposerSubmission(
  { composer, submitted }: { composer: UseComposerResult; submitted: UseComposerResult | null }, _options = {},
): boolean {
  return submitted === composer || (submitted !== null && composer.draft.trim() === '' && submitted.attachments === composer.attachments);
}

function composerDeliveryBlocked(
  { delivering, starting, composer, submitted }: {
    delivering: boolean; starting: boolean; composer: UseComposerResult; submitted: UseComposerResult | null;
  }, _options = {},
): boolean {
  return delivering || starting || isRepeatedComposerSubmission({ composer, submitted });
}

function resolveRunContext(
  { context, input }: { context: ChatPaneRunContext | undefined; input: ChatPaneRunContextInput }, _options = {},
): RunContext | undefined {
  return typeof context === 'function' ? context(input) : context;
}

function assertPromptSendable(
  { trimmed, sendBlocker }: { trimmed: string; sendBlocker: ChatPaneSendBlocker | null },
  _options = {},
): void {
  if (!trimmed) throw new Error('cannot send: the prompt is empty');
  if (sendBlocker !== null) throw new Error(`cannot send: ${describeChatPaneSendBlocker(sendBlocker)}`);
}

function createChatLocalId(_required: {}, _options: {} = {}): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Hands one typed answer to the host. A throw counts as `'failed'`: the host could not say whether
 * anything was waiting, and the one outcome that must never follow is queueing the text as a new run.
 *
 * @complexity O(1) plus the host's own request.
 */
async function deliverTypedAnswerSafely(
  { deliver, text }: { deliver: DeliverTypedAnswer; text: string },
): Promise<TypedAnswerDelivery> {
  try {
    return await deliver({ text });
  } catch {
    return 'failed';
  }
}

/**
 * Hands one mid-run message to the host. A throw counts as `'failed'`: retain the draft because
 * the host could not establish delivery, rather than starting another run on a network failure.
 *
 * @complexity O(1) plus the host's own request.
 */
async function deliverMidRunMessageSafely(
  { deliver, ...input }: { deliver: DeliverMidRunMessage } & Parameters<DeliverMidRunMessage>[0],
): Promise<MidRunMessageDelivery> {
  try {
    return await deliver(input);
  } catch {
    return 'failed';
  }
}

/** Module scope so each branch costs 1 cognitive point instead of 2 (nested one level inside
 * `useChatPane` where it used to live as a ternary chain). */
function resolveChatPaneActivity(
  selectedAgent: ChatPaneAgent | undefined,
  conversation: UseConversationResult,
): ChatPaneActivity {
  if (selectedAgent === undefined) return 'unavailable';
  if (conversation.error) return 'failed';
  if (conversation.isStreaming) return 'streaming';
  return 'ready';
}

/** Hold new input until its uploads or human gate settle; the existing queue owns the retry.
 * @complexity O(e) in the newest message's events, with no I/O.
 */
function waitingForLiveInput(
  { uploadPending, messages }: { uploadPending: boolean; messages: readonly ChatMessage[] }, _options = {},
): boolean {
  return uploadPending || isAwaitingAnswer({ events: messages.at(-1)?.events });
}

/**
 * The host delivery and live run a send can go INTO instead of queueing behind, or `null` when the
 * host offers no mid-run delivery or no run can take it ({@link findMidRunMessageRunId}).
 *
 * @complexity O(e) in the newest message's events.
 */
function findMidRunTarget(
  { deliver, blocker, attachmentCount, messages }: {
    deliver: DeliverMidRunMessage | undefined;
    blocker: ChatPaneSendBlocker | null;
    attachmentCount: number;
    messages: readonly ChatMessage[];
  },
): { deliver: DeliverMidRunMessage; runId: string } | null {
  if (deliver === undefined) return null;
  const runId = findMidRunMessageRunId({ blocker, attachmentCount, messages });
  return runId === null ? null : { deliver, runId };
}

/**
 * The host's typed-answer delivery and the id of the question it answers when this send answers
 * the question the run is waiting on, else `null`. The same test as `isTypedAnswerTurn` in
 * `rules.ts`, unfolded so the awaited question's id comes back with the deliverer — a typed answer
 * therefore always carries the id of the question it answers.
 *
 * @complexity O(m) over the messages scanned for the open question.
 */
function findTypedAnswerTarget(
  { deliver, blocker, attachmentCount, messages }: {
    deliver: DeliverTypedAnswer | undefined;
    blocker: ChatPaneSendBlocker | null;
    attachmentCount: number;
    messages: readonly ChatMessage[];
  },
): { deliver: DeliverTypedAnswer; questionId: string } | null {
  if (deliver === undefined || !isChatPaneQueueableBlocker({ blocker }) || attachmentCount !== 0) return null;
  const questionId = findAwaitedTypedAnswerId({ messages, toolName: deliver.toolName });
  return questionId === null ? null : { deliver, questionId };
}

/**
 * Whether a delivered mid-run turn took every staged attachment with it, so the next staged file
 * starts a fresh upload batch. Not while an upload is still landing: that file joins this batch.
 *
 * @complexity O(s * t) over the staged and sent attachments (both a handful).
 */
function deliveredEveryStagedAttachment(
  { sent, staged, activeUploadCount }: {
    sent: readonly ChatAttachment[];
    staged: readonly ChatAttachment[];
    activeUploadCount: number;
  },
): boolean {
  if (activeUploadCount > 0 || sent.length === 0) return false;
  return staged.every(attachment => sent.some(item => item.path === attachment.path));
}

/**
 * Runs one attachment upload and, unless superseded/unmounted/aborted by the time it resolves,
 * hands the results (or error) to the caller's effects. Concurrent by design — unlike
 * {@link useLatestOperation}'s latest-wins model, several batches may be in flight at once
 * (`addAttachments`'s `activeUploadsRef` is a `Set`, not a single slot) — so this takes an explicit
 * `stillWanted()` check per attempt rather than a shared generation token.
 *
 * Zips each resolved `ChatAttachment` back to the `File` at its same index before calling
 * `onAttachment`, same assumption `useComposer.ts`'s own `addAttachments` documents ("resolves 1:1
 * with files, in order, on success") — `effects.upload`'s one shipped implementation
 * (`create-daemon-attachment-uploader.ts`) either returns one attachment per input file or throws,
 * so the arrays are always the same length on the success path this runs. `file` is passed through
 * as possibly `undefined` rather than asserted, so a non-conforming custom `uploadAttachments` host
 * prop degrades to "attachment staged, preview not cached" instead of throwing.
 */
async function uploadAttachmentBatch(
  files: File[],
  effects: {
    upload: (files: File[], options: ChatPaneAttachmentUploadOptions) => Promise<ChatAttachment[]>;
    signal: AbortSignal;
    batchId: string;
    stillWanted: () => boolean;
    onAttachment: (attachment: ChatAttachment, file: File | undefined) => void;
    onError: (error: Error) => void;
  },
): Promise<void> {
  try {
    const uploaded = await effects.upload(files, { signal: effects.signal, batchId: effects.batchId });
    if (!effects.stillWanted()) return;
    uploaded.forEach((attachment, index) => effects.onAttachment(attachment, files[index]));
  } catch (error) {
    if (!effects.stillWanted()) return;
    effects.onError(error instanceof Error ? error : new Error(String(error)));
  }
}

export function useChatPane(options: UseChatPaneOptions): UseChatPaneResult {
  const guard = useUserTextGuard(options);
  const [activeUploadCount, setActiveUploadCount] = useState(0);
  const [attachmentError, setAttachmentError] = useState<Error | null>(null);
  // MOVE: Keep the signal with each sanitized input; re-redaction cannot detect the original paste.
  const [storedQueuedInputs, setQueuedInputs] = useState<QueuedChatInput[]>([]);
  // MOVE: Uploads belong to the input that submitted them, even if a later message is queued first.
  const queuedUploadOwnersRef = useRef(new Map<AbortController, string>());
  // A send held for uploads or a human card resumes live; a refused delivery waits for run end.
  const queuedForLiveDeliveryRef = useRef(false);
  const submittedComposerRef = useRef<UseComposerResult | null>(null);
  const startingPromptRef = useRef(false);
  const refusedSendRef = useRef<{ redaction: UserTextRedaction; draft: string; attachments: ChatAttachment[] } | null>(null);
  const [typedAnswerNotice, setTypedAnswerNotice] = useState<TypedAnswerNotice | null>(null);
  // Shared delivery lock: a second Enter cannot submit the same answer or screenshot twice.
  const deliveringTypedAnswerRef = useRef(false);
  // MOVE: A delivered or definitively closed question cannot consume the next draft before tool_result arrives.
  const answeredQuestionIdRef = useRef<string | null>(null);
  // Bumped by `reset()` and a conversation switch; a delivery that settles under a different value
  // belongs to a composer that no longer exists and must neither clear the draft nor set a notice.
  const typedAnswerGenerationRef = useRef(0);
  const typedAnswerConversationRef = useRef(options.conversationId);
  // The conversation `queuedPrompt` was queued against. Compared with `options.conversationId` at
  // flush time so a prompt queued behind a streaming run in one conversation can never be posted
  // into a different one the caller switched to before that run finished.
  const queuedConversationIdRef = useRef<string | null | undefined>(undefined);
  const mountedRef = useRef(true);
  const attachmentGenerationRef = useRef(0);
  // Every attachment staged for one turn must share one upload batch (the daemon refuses a turn
  // spanning two). So a mount that will restore cached attachments starts in THEIR batch rather
  // than a new one; see `readCachedAttachmentBatchId`.
  const [initialAttachmentBatchId] = useState(
    () => readCachedAttachmentBatchId({ conversationId: options.conversationId }) ?? createChatLocalId({}),
  );
  const attachmentBatchIdRef = useRef(initialAttachmentBatchId);
  const batchConversationIdRef = useRef(options.conversationId);
  const activeUploadsRef = useRef(new Set<AbortController>());
  const [internalSelection, setInternalSelection] = useState<ChatPaneAgentSelection>(
    options.initialSelection ?? { agentId: '' },
  );
  const workingDirectoryState = useChatPaneWorkingDirectory(definedProps({ source: {
    workingDirectory: options.workingDirectory,
    initialWorkingDirectory: options.initialWorkingDirectory,
    onChangeWorkingDirectory: options.onChangeWorkingDirectory,
    workingDirectoryAccess: options.workingDirectoryAccess,
  } }));
  const requestedSelection = options.selection ?? internalSelection;
  const resolvedSelection = useMemo(
    () => resolveChatPaneSelection({ agents: options.agents, requested: requestedSelection }),
    [options.agents, requestedSelection],
  );
  // Inline inventories and controlled selections can be new objects on every render. Keep the
  // normalized value stable so synchronizing it into composer state cannot feed a render loop.
  const selection = useMemo(() => definedProps({ source: {
    agentId: resolvedSelection.agentId,
    model: resolvedSelection.model,
    reasoning: resolvedSelection.reasoning,
  } }), [resolvedSelection.agentId, resolvedSelection.model, resolvedSelection.reasoning]);
  const selectedAgent = options.agents.find((agent) => agent.id === selection.agentId);
  const conversation = useConversation(definedProps({ source: {
    transport: options.transport,
    redactUserText: options.redactUserText,
    onSecretRedacted: guard.notifyRedaction,
    initialMessages: options.initialMessages,
    refreshSignal: options.refreshSignal,
    conversationId: options.conversationId,
    // Keys off an empty string, not `undefined` — `selection.agentId` is always a string (never
    // absent), so only the falsy "no agent selected" case should omit the key.
    agentId: selection.agentId || undefined,
  } }));
  const composer = useComposer(definedProps({ source: {
    initialDraft: options.initialDraft,
    historyMessages: conversation.messages,
    historyScope: options.composerHistoryScope,
    historyStorage: options.composerHistoryStorage,
    historyCap: options.composerHistoryCap,
    initialAgent: selection,
    conversationId: options.conversationId,
    validateAttachments: options.validateAttachments,
  } }));

  const activity: ChatPaneActivity = resolveChatPaneActivity(selectedAgent, conversation);

  const queuedInputs = useMemo(() => unconsumedQueuedInputs({ inputs: storedQueuedInputs, messages: conversation.messages }), [storedQueuedInputs, conversation.messages]);
  const queuedTurn = useMemo(() => queuedInputs.reduce<UserTextRedaction | null>((queued, input) => appendQueuedTurn({
    queued, next: { text: input.text, secretRedacted: input.secretRedaction?.secretRedacted ?? false,
      count: input.secretRedaction?.count ?? 0 },
  }), null), [queuedInputs]);
  // Release consumed text/files locally as well as hiding them; next-turn fallback uses this same projection.
  useEffect(() => {
    if (queuedInputs.length !== storedQueuedInputs.length) setQueuedInputs(queuedInputs);
  }, [queuedInputs, storedQueuedInputs.length]);

  useEffect(() => {
    options.onActivityChange?.(activity);
  }, [activity, options.onActivityChange]);

  useEffect(() => {
    options.onMessagesChange?.(conversation.messages);
  }, [conversation.messages, options.onMessagesChange]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      attachmentGenerationRef.current += 1;
      for (const controller of activeUploadsRef.current) controller.abort();
      activeUploadsRef.current.clear();
    };
  }, []);

  const selectionControlled = options.selection !== undefined;
  const setComposerAgent = composer.setAgent;
  useEffect(() => {
    if (!selection.agentId) return;
    if (
      requestedSelection.agentId === selection.agentId
      && requestedSelection.model === selection.model
      && requestedSelection.reasoning === selection.reasoning
    ) return;
    if (!selectionControlled) setInternalSelection(selection);
    setComposerAgent(selection);
    options.onSelectionChange?.(selection);
  }, [
    setComposerAgent,
    options.onSelectionChange,
    selectionControlled,
    requestedSelection.agentId,
    requestedSelection.model,
    requestedSelection.reasoning,
    selection,
  ]);

  const setSelection = useCallback((next: ChatPaneAgentSelection) => {
    const validated = resolveChatPaneSelection({ agents: options.agents, requested: next });
    setInternalSelection(validated);
    composer.setAgent(validated);
    options.onSelectionChange?.(validated);
  }, [composer, options.agents, options.onSelectionChange]);

  const sendBlocker = findChatPaneSendBlocker({
    ...(selection.model ? { model: selection.model } : {}),
    selectedAgent,
    isStreaming: conversation.isStreaming,
    activeUploadCount,
    workingDirectoryPending: workingDirectoryState.workingDirectoryPending,
    workingDirectoryInvalid: workingDirectoryState.workingDirectoryInvalid,
    workingDirectoryError: workingDirectoryState.workingDirectoryError,
    // `exactOptionalPropertyTypes` rejects `apiModeConfigured: undefined` outright, so this stays a
    // ternary rather than routing through `definedProps` — that helper would also make
    // `selectedAgent` optional in its return type (its value type already includes `undefined`),
    // which no longer structurally matches `ChatPaneSendability`'s required `selectedAgent` key.
    ...(options.apiModeConfigured === undefined ? {} : { apiModeConfigured: options.apiModeConfigured }),
  });
  const canSend = sendBlocker === null && composer.canSubmit;
  // Read after `await` in `answerWaitingQuestion`, where the render-time `composer.draft` is stale.
  const latestComposerRef = useRef(composer);
  latestComposerRef.current = composer;
  const latestDraftRef = useRef(composer.draft);
  latestDraftRef.current = composer.draft;
  const latestAttachmentsRef = useRef(composer.attachments);
  latestAttachmentsRef.current = composer.attachments;

  useEffect(() => {
    const previous = typedAnswerConversationRef.current;
    typedAnswerConversationRef.current = options.conversationId;
    // First-turn adoption gives the existing composer its server key; it does not replace it.
    if (previous === options.conversationId || (previous == null && options.conversationId != null)) return;
    typedAnswerGenerationRef.current += 1;
  }, [options.conversationId]);

  // A conversation switch without a remount: adopt the batch of the attachments the composer is
  // about to restore for the new conversation, else start a fresh one so two conversations never
  // share a batch directory (the agent is granted the whole directory, not just the claimed files).
  // An id arriving where there was none is the same conversation finally getting a key — the
  // composer keeps what is staged (see `useComposer`), so the batch stays too.
  useEffect(() => {
    const previousConversationId = batchConversationIdRef.current;
    if (options.conversationId === previousConversationId) return;
    batchConversationIdRef.current = options.conversationId;
    const restoredBatchId = readCachedAttachmentBatchId({ conversationId: options.conversationId });
    if (restoredBatchId !== null) {
      attachmentBatchIdRef.current = restoredBatchId;
      return;
    }
    if (previousConversationId == null) return;
    attachmentBatchIdRef.current = createChatLocalId({});
  }, [options.conversationId]);

  const addAttachments = useCallback(async (files: File[]) => {
    if (files.length === 0 || options.uploadAttachments === undefined) return;
    // MOVE: A new upload is a fresh submission, including before its first attachment resolves.
    submittedComposerRef.current = null;
    const generation = attachmentGenerationRef.current;
    const batchId = attachmentBatchIdRef.current;
    const conversationId = options.conversationId;
    const controller = new AbortController();
    activeUploadsRef.current.add(controller);
    setActiveUploadCount(activeUploadsRef.current.size);
    setAttachmentError(null);
    try {
      await uploadAttachmentBatch(files, {
        upload: options.uploadAttachments,
        signal: controller.signal,
        batchId,
        stillWanted: () => mountedRef.current
          && !controller.signal.aborted
          && generation === attachmentGenerationRef.current,
        // Caches the original `File` right here, at the one point this closure has both it and the
        // resulting `ChatAttachment` paired — mirrors `useComposer.ts`'s own `addAttachments`, which
        // does the same pairing for its (separate, currently unused-in-production) upload path. See
        // `attachment-preview-cache.ts`'s module doc for why this is the only place that copy can
        // ever be captured.
        onAttachment: (attachment, file) => {
          // Recorded before staging so the cache entry that persists this attachment carries its
          // batch, which is what lets a later mount restore the batch along with the attachment.
          writeCachedAttachmentBatchId({ conversationId, batchId });
          const inputId = queuedUploadOwnersRef.current.get(controller);
          if (inputId === undefined) composer.addAttachment(attachment);
          else setQueuedInputs(inputs => inputs.map(input => input.id === inputId
            ? { ...input, attachments: [...input.attachments, attachment] } : input));
          if (file) cacheAttachmentPreviewSource({ path: attachment.path, file });
        },
        onError: setAttachmentError,
      });
    } finally {
      queuedUploadOwnersRef.current.delete(controller);
      if (activeUploadsRef.current.delete(controller) && mountedRef.current) {
        setActiveUploadCount(activeUploadsRef.current.size);
      }
    }
  }, [composer, options.conversationId, options.uploadAttachments]);

  /** Acceptance is the only writer of local recall and optimistic in-run bubbles. */
  const recordAcceptedInput = useCallback((
    { inputs, bubble }: { inputs: AcceptedChatInput[]; bubble?: { text: string; toolUseId?: string; afterInputId?: string; atEventCount?: number } },
    { receipt = 'optimistic' }: { receipt?: 'optimistic' | 'accepted' } = {},
  ) => {
    composer.history?.record({ inputs });
    submittedComposerRef.current = composer;
    if (bubble === undefined) return;
    conversation.setMessages(messages => {
      const last = messages.at(-1);
      if (last?.role !== 'assistant') return messages;
      const { atEventCount, ...eventBubble } = bubble;
      const event = acceptedInputUserEvent({ input: { id: inputs[0]!.id, text: bubble.text,
        ...(inputs[0]!.deliveryState ? { deliveryState: inputs[0]!.deliveryState } : {}) },
        inputs, ...eventBubble }, { receipt });
      const events = last.events ?? [];
      const position = atEventCount ?? events.length;
      return [...messages.slice(0, -1), { ...last,
        events: projectAcceptedInputEvents({ events: [...events.slice(0, position), event, ...events.slice(position)] }) }];
    });
  }, [composer, conversation.setMessages]);

  /** Both accepted send paths consume the sent files and rotate the same upload batch. */
  const consumeDeliveredAttachments = useCallback(({ attachments }: { attachments: ChatAttachment[] }, _options = {}) => {
    for (const attachment of attachments) latestComposerRef.current.removeAttachment(attachment.path);
    if (deliveredEveryStagedAttachment({
      sent: attachments, staged: latestAttachmentsRef.current, activeUploadCount: activeUploadsRef.current.size,
    })) attachmentBatchIdRef.current = createChatLocalId({});
  }, []);

  /** MOVE: A rejected queue flush restores its captured files alongside the text for an honest retry. */
  const restoreQueuedDraft = useCallback((
    { inputs, text, attachments }: { inputs: AcceptedChatInput[] | undefined; text: string; attachments: ChatAttachment[] }, _options = {},
  ) => {
    if (inputs === undefined) return;
    latestComposerRef.current.setDraft([text, latestDraftRef.current].filter(Boolean).join('\n\n'));
    const staged = new Set(latestAttachmentsRef.current.map(attachment => attachment.path));
    for (const attachment of attachments) {
      if (!staged.has(attachment.path)) latestComposerRef.current.addAttachment(attachment);
    }
  }, []);

  /** A refused composer send is kept for Retry and goes back only into a composer that is still
   * empty: text typed (or files staged) while it was sending are never overwritten. */
  const restoreRefusedDraft = useCallback((
    { redaction, draft, attachments }: { redaction: UserTextRedaction; draft: string; attachments: ChatAttachment[] }, _options = {},
  ) => {
    refusedSendRef.current = { redaction, draft, attachments };
    if (latestDraftRef.current.trim() !== '' || latestAttachmentsRef.current.length > 0) return;
    latestComposerRef.current.setDraft(draft);
    for (const attachment of attachments) latestComposerRef.current.addAttachment(attachment);
  }, []);

  const finishPromptSend = useCallback((
    { accepted, inputs, redaction, submittedDraft, attachments, composerDraft }: {
      accepted: boolean; inputs: AcceptedChatInput[] | undefined; redaction: UserTextRedaction;
      submittedDraft: string; attachments: ChatAttachment[]; composerDraft: string | undefined;
    }, _options = {},
  ) => {
    if (!accepted) {
      if (composerDraft === undefined) restoreQueuedDraft({ inputs, text: redaction.text, attachments });
      else restoreRefusedDraft({ redaction, draft: composerDraft, attachments });
      return;
    }
    refusedSendRef.current = null;
    // A composer send emptied the composer when it started; what is there now was typed since.
    if (composerDraft === undefined && inputs === undefined && latestDraftRef.current === submittedDraft) {
      latestComposerRef.current.setDraft('');
      latestComposerRef.current.closeMention();
    }
    consumeDeliveredAttachments({ attachments });
  }, [consumeDeliveredAttachments, restoreQueuedDraft, restoreRefusedDraft]);

  /** `composerDraft`: the composer text this send already took out of the composer, so the
   * composer is never cleared again on acceptance and a refusal hands the text back. */
  const sendGuardedPrompt = useCallback(async (
    { redaction, inputs, attachments = composer.attachments, composerDraft }: {
      redaction: UserTextRedaction; inputs?: AcceptedChatInput[]; attachments?: ChatAttachment[]; composerDraft?: string;
    }, _options = {},
  ) => {
    const trimmed = redaction.text.trim();
    assertPromptSendable({ trimmed, sendBlocker });
    if (startingPromptRef.current) return;
    startingPromptRef.current = true;
    const generation = typedAnswerGenerationRef.current;
    const submittedDraft = latestDraftRef.current;
    try {
      const context = resolveRunContext({ context: options.runContext,
        input: { prompt: trimmed, selection, workingDirectory: workingDirectoryState.workingDirectory } });
      options.onActivityChange?.('queued');
      let accepted = false;
      await conversation.sendMessage(trimmed, definedProps({ source: {
        secretRedaction: redaction.secretRedacted ? { secretRedacted: true as const, count: redaction.count } : undefined,
        agentId: selection.agentId,
        // Empty attachment arrays remain absent at the transport boundary.
        attachments: attachments.length === 0 ? undefined : attachments,
        context,
        acceptedInputs: inputs,
        onAccepted: ({ inputs: acceptedInputs }: { inputs: AcceptedChatInput[] }) => {
          accepted = true;
          if (mountedRef.current && generation === typedAnswerGenerationRef.current) recordAcceptedInput({ inputs: acceptedInputs });
        },
      } }));
      if (!mountedRef.current || generation !== typedAnswerGenerationRef.current) return;
      finishPromptSend({ accepted, inputs, redaction, submittedDraft, attachments, composerDraft });
    } finally { startingPromptRef.current = false; }
  }, [composer, conversation, options.onActivityChange, options.runContext, recordAcceptedInput, finishPromptSend,
    selection, sendBlocker, workingDirectoryState.workingDirectory]);

  const sendPrompt = useCallback(async (prompt: string) => {
    await sendGuardedPrompt({ redaction: guard.redact({ text: prompt.trim() }, {}) });
  }, [guard.redact, sendGuardedPrompt]);

  // Owner, 2026-10-27: the sent text sat in the composer for seconds until the server accepted the
  // run. The composer empties on send; the text waits here until the start is accepted or refused.
  const sendComposerPrompt = useCallback(async (prompt: string) => {
    if (sendBlocker !== null || startingPromptRef.current) return;
    const draft = latestDraftRef.current;
    const attachments = latestAttachmentsRef.current;
    latestComposerRef.current.setDraft('');
    latestComposerRef.current.closeMention();
    for (const attachment of attachments) latestComposerRef.current.removeAttachment(attachment.path);
    const redaction = guard.redact({ text: prompt.trim() }, {});
    try {
      await sendGuardedPrompt({ redaction, attachments, composerDraft: draft });
    } catch (error) {
      // A host hook that throws (run context, activity) must not cost the typed text either.
      restoreRefusedDraft({ redaction, draft, attachments });
      throw error;
    }
  }, [guard.redact, restoreRefusedDraft, sendBlocker, sendGuardedPrompt]);

  // MOVE: Every queue path retains per-message receipts; appendQueuedTurn owns their one-turn delivery.
  // A turn queued against another conversation is not joined — it would never be flushed there anyway.
  const enqueueTurn = useCallback((
    { turn, inputs, attachments = composer.attachments }: {
      turn: UserTextRedaction; inputs?: QueuedChatInput[]; attachments?: ChatAttachment[];
    }, _options = {},
  ) => {
    const accepted: QueuedChatInput[] = inputs ?? [{ id: createChatLocalId({}), text: turn.text, attachments,
      ...(turn.secretRedacted ? { secretRedaction: { secretRedacted: true as const, count: turn.count } } : {}) }];
    const sameConversation = queuedConversationIdRef.current === options.conversationId;
    queuedConversationIdRef.current = options.conversationId;
    for (const controller of activeUploadsRef.current) {
      if (!queuedUploadOwnersRef.current.has(controller)) queuedUploadOwnersRef.current.set(controller, accepted.at(-1)!.id);
    }
    recordAcceptedInput({ inputs: accepted });
    setQueuedInputs(queued => [...(sameConversation ? queued : []), ...accepted]);
    // MOVE: Take files out of the composer without rotating their batch: every queued message ships together.
    for (const attachment of attachments) latestComposerRef.current.removeAttachment(attachment.path);
  }, [composer.attachments, options.conversationId, recordAcceptedInput]);

  const answerWaitingQuestion = useCallback(async (
    { deliver, questionId, text }: { deliver: DeliverTypedAnswer; questionId: string; text: string },
  ) => {
    const safeText = guard.redactText(text);
    const generation = typedAnswerGenerationRef.current;
    const submittedDraft = latestDraftRef.current;
    deliveringTypedAnswerRef.current = true;
    const outcome = await deliverTypedAnswerSafely({ deliver, text: safeText });
    deliveringTypedAnswerRef.current = false;
    if (!mountedRef.current || generation !== typedAnswerGenerationRef.current) return;
    if (outcome === 'failed') {
      setTypedAnswerNotice(outcome);
      return;
    }
    if (outcome === 'not-pending') {
      // MOVE: A definitive refusal accepted no answer; the existing queue owns one normal-send fallback.
      enqueueTurn({ turn: guard.redact({ text: safeText }, {}), attachments: [] });
    } else {
      recordAcceptedInput({ inputs: [{ id: `answer:${questionId}`, text: safeText }],
        bubble: { text: safeText, toolUseId: questionId } });
    }
    answeredQuestionIdRef.current = questionId;
    // The textarea stays editable during delivery: clear only the text that went out, never a
    // correction or next message typed while the host answered.
    if (latestDraftRef.current === submittedDraft) latestComposerRef.current.setDraft('');
  }, [enqueueTurn, guard.redact, guard.redactText, recordAcceptedInput]);

  const clearDeliveredDraft = useCallback((
    { inputs, submittedDraft }: { inputs: AcceptedChatInput[] | undefined; submittedDraft: string }, _options = {},
  ) => {
    if (inputs === undefined && latestDraftRef.current === submittedDraft) latestComposerRef.current.setDraft('');
  }, []);

  /** HTTP acceptance retains fallback ownership; only an actual consumption receipt removes it. */
  const retainAcceptedMidRunInput = useCallback((
    { outcome, inputs, turn, attachments, afterInputId, atEventCount }: {
      outcome: 'delivered' | { readonly delivery: 'delivered'; readonly id: string };
      inputs: QueuedChatInput[] | undefined; turn: UserTextRedaction;
      attachments: ChatAttachment[]; afterInputId: string | undefined; atEventCount: number;
    }, _options = {},
  ) => {
    const accepted = inputs ?? [{ id: createChatLocalId({}), text: turn.text, attachments,
      ...(turn.secretRedacted ? { secretRedaction: { secretRedacted: true as const, count: turn.count } } : {}) }];
    const id = typeof outcome === 'object' ? outcome.id : accepted[0]!.id;
    // A known HTTP id is already authoritative. Do not let equal text reconcile an unrelated
    // wire receipt into this bubble; legacy hosts alone still need optimistic reconciliation.
    const retained = accepted.map((input, index) => ({ ...input,
      ...(index === 0 ? { id, aliases: [...(input.aliases ?? []), input.id] } : {}),
      liveMessageId: id, deliveryState: 'queued' as const,
    }));
    queuedConversationIdRef.current = options.conversationId;
    setQueuedInputs(queued => [...queued, ...retained]);
    recordAcceptedInput({ inputs: retained,
      bubble: { text: turn.text, atEventCount, ...(afterInputId === undefined ? {} : { afterInputId }) } },
    typeof outcome === 'object' ? { receipt: 'accepted' } : {});
  }, [options.conversationId, recordAcceptedInput]);

  const finishMidRunSend = useCallback((
    { outcome, inputs, turn, attachments, afterInputId, submittedDraft, atEventCount }: {
      outcome: MidRunMessageDelivery; inputs: QueuedChatInput[] | undefined; turn: UserTextRedaction;
      attachments: ChatAttachment[]; afterInputId: string | undefined; submittedDraft: string; atEventCount: number;
    }, _options = {},
  ) => {
    if (outcome === 'failed') {
      restoreQueuedDraft({ inputs, text: turn.text, attachments });
      setTypedAnswerNotice('failed');
      return;
    }
    if (outcome === 'delivered' || typeof outcome === 'object') {
      retainAcceptedMidRunInput({ outcome, inputs, turn, attachments, afterInputId, atEventCount });
      clearDeliveredDraft({ inputs, submittedDraft });
      consumeDeliveredAttachments({ attachments });
      return;
    }
    enqueueTurn({ turn, attachments, ...(inputs === undefined ? {} : { inputs }) });
    clearDeliveredDraft({ inputs, submittedDraft });
  }, [enqueueTurn, retainAcceptedMidRunInput, clearDeliveredDraft, consumeDeliveredAttachments, restoreQueuedDraft]);

  // A delivered steer belongs to the existing run; unsupported turns use the same accepted queue.
  // A failed delivery keeps the working draft so retry cannot silently become another run.
  const sendIntoRunningTurn = useCallback(async (
    { deliver, runId, turn, inputs, attachments = composer.attachments }: {
      deliver: DeliverMidRunMessage; runId: string; turn: UserTextRedaction; inputs?: QueuedChatInput[]; attachments?: ChatAttachment[];
    },
    _options = {},
  ) => {
    const submittedDraft = latestDraftRef.current;
    const priorEvents = conversation.messages.at(-1)?.events ?? [];
    const afterInputId = projectAcceptedInputEvents({ events: priorEvents }).flatMap(event => {
      const input = acceptedInputEvent({ event });
      return input ? [input.data.id] : [];
    }).at(-1);
    const generation = typedAnswerGenerationRef.current;
    deliveringTypedAnswerRef.current = true;
    const outcome = await deliverMidRunMessageSafely({ deliver, runId, text: turn.text,
      ...(attachments.length ? { attachments } : {}),
    });
    deliveringTypedAnswerRef.current = false;
    if (!mountedRef.current || generation !== typedAnswerGenerationRef.current) return;
    // The reply may stream before HTTP 202 resolves. Anchor the bubble to send time, not response time.
    finishMidRunSend({ outcome, inputs, turn, attachments, afterInputId, submittedDraft, atEventCount: priorEvents.length });
  }, [composer, conversation, finishMidRunSend]);

  // The ordinary next-turn path: into the running run, else queue behind it, else send now.
  const sendOrdinaryTurn = useCallback(async (prompt: string) => {
    if (!isChatPaneQueueableBlocker({ blocker: sendBlocker })) {
      if (canSend) await sendComposerPrompt(prompt);
      return;
    }
    const turn = guard.redact({ text: prompt }, {});
    const uploadPending = activeUploadsRef.current.size > 0 || attachmentError !== null;
    // Retry live delivery after the human gate settles, using the same queue as pending uploads.
    if (waitingForLiveInput({ uploadPending, messages: conversation.messages })) {
      queuedForLiveDeliveryRef.current = queuedTurn === null || queuedForLiveDeliveryRef.current;
    }
    // MOVE: The existing queue owns its files; a later steer must join it to preserve send order.
    const target = uploadPending || queuedInputs.some(input => input.liveMessageId === undefined) ? null : findMidRunTarget({
      deliver: options.deliverMidRunMessage,
      blocker: sendBlocker,
      attachmentCount: composer.attachments.length,
      messages: conversation.messages,
    });
    if (target !== null) {
      await sendIntoRunningTurn({ ...target, turn });
      return;
    }
    // MOVE: Queue owns the staged attachments before clearing the draft, so neither can be lost.
    enqueueTurn({ turn });
    composer.setDraft('');
  }, [
    canSend,
    attachmentError,
    composer,
    conversation.messages,
    enqueueTurn,
    options.deliverMidRunMessage,
    queuedTurn,
    queuedInputs,
    sendBlocker,
    sendIntoRunningTurn,
    sendComposerPrompt,
    guard.redact,
  ]);

  const send = useCallback(async () => {
    const uploadingWhileStreaming = conversation.isStreaming && activeUploadsRef.current.size > 0;
    const prompt = composerPrompt(composer) || (uploadingWhileStreaming ? ATTACHMENTS_ONLY_PROMPT : '');
    if (!prompt || composerDeliveryBlocked({ delivering: deliveringTypedAnswerRef.current, starting: startingPromptRef.current, composer, submitted: submittedComposerRef.current })) return;
    setTypedAnswerNotice(null);
    // Until upload completes, an empty attachment list is not evidence of a text-only answer.
    if (uploadingWhileStreaming) {
      await sendOrdinaryTurn(prompt);
      return;
    }
    const typedAnswer = findTypedAnswerTarget({
      deliver: options.deliverTypedAnswer,
      blocker: sendBlocker,
      attachmentCount: composer.attachments.length,
      messages: conversation.messages,
    });
    if (typedAnswer !== null && typedAnswer.questionId !== answeredQuestionIdRef.current) {
      await answerWaitingQuestion({ ...typedAnswer, text: prompt });
      return;
    }
    await sendOrdinaryTurn(prompt);
  }, [
    answerWaitingQuestion,
    composer,
    conversation.isStreaming,
    conversation.messages,
    options.deliverTypedAnswer,
    sendBlocker,
    sendOrdinaryTurn,
  ]);

  const retrySend = useCallback(async () => {
    const refused = refusedSendRef.current;
    if (refused === null || latestDraftRef.current === refused.draft) {
      await send();
      return;
    }
    if (sendBlocker !== null || startingPromptRef.current) return;
    await sendGuardedPrompt({ redaction: refused.redaction, attachments: refused.attachments, composerDraft: refused.draft });
  }, [send, sendBlocker, sendGuardedPrompt]);

  const sendAsNewMessage = useCallback(async () => {
    const prompt = composerPrompt(composer);
    if (!prompt || composerDeliveryBlocked({ delivering: deliveringTypedAnswerRef.current, starting: startingPromptRef.current, composer, submitted: submittedComposerRef.current })) return;
    setTypedAnswerNotice(null);
    await sendOrdinaryTurn(prompt);
  }, [composer, sendOrdinaryTurn]);

  const interruptSend = useCallback(() => {
    const prompt = composerPrompt(composer);
    if (!prompt || composerDeliveryBlocked({ delivering: deliveringTypedAnswerRef.current, starting: startingPromptRef.current, composer, submitted: submittedComposerRef.current })) return;
    enqueueTurn({ turn: guard.redact({ text: prompt }, {}) });
    composer.setDraft('');
    conversation.cancel();
  }, [composer, conversation, enqueueTurn, guard.redact]);

  /** Abort only uploads owned by the removed inputs; late completions must not refill the composer. */
  const discardQueuedUploads = useCallback(({ id }: { id?: string }, _options = {}) => {
    for (const [controller, owner] of queuedUploadOwnersRef.current) {
      if (id !== undefined && owner !== id) continue;
      controller.abort();
      activeUploadsRef.current.delete(controller);
      queuedUploadOwnersRef.current.delete(controller);
    }
    setActiveUploadCount(activeUploadsRef.current.size);
  }, []);

  const cancelQueued = useCallback(() => {
    submittedComposerRef.current = null;
    queuedForLiveDeliveryRef.current = false;
    queuedConversationIdRef.current = undefined;
    discardQueuedUploads({});
    setQueuedInputs([]);
  }, [discardQueuedUploads]);

  const cancelQueuedMessage = useCallback(({ id }: { id: string }, _options = {}) => {
    submittedComposerRef.current = null;
    discardQueuedUploads({ id });
    setQueuedInputs(inputs => inputs.filter(input => input.id !== id));
  }, [discardQueuedUploads]);

  // Upload-waiting sends can steer once the image arrives. Other queued turns wait for a fully
  // clear blocker. Clear the slot before awaiting so re-renders cannot send it twice.
  useEffect(() => {
    if (queuedTurn === null) {
      queuedForLiveDeliveryRef.current = false;
      return;
    }
    if (queuedConversationIdRef.current !== options.conversationId) {
      // The conversation changed while this prompt waited behind a streaming run — sending it now
      // would post it into a conversation the user never saw it queued against. Drop it instead
      // (same as `cancelQueued`) rather than misrouting it.
      cancelQueued();
      return;
    }
    if (activeUploadCount > 0 || attachmentError !== null) return;
    const target = queuedForLiveDeliveryRef.current ? findMidRunTarget({
      deliver: options.deliverMidRunMessage,
      blocker: sendBlocker, attachmentCount: queuedInputs.flatMap(input => input.attachments).length, messages: conversation.messages,
    }) : null;
    if (target === null && (sendBlocker !== null || awaitingRunReceipts({ inputs: queuedInputs, messages: conversation.messages }))) return;
    queuedForLiveDeliveryRef.current = false;
    const inputs = queuedInputs;
    const attachments = inputs.flatMap(input => input.attachments);
    setQueuedInputs([]);
    if (target !== null) {
      void sendIntoRunningTurn({ ...target, turn: queuedTurn, inputs, attachments });
      return;
    }
    void sendGuardedPrompt({ redaction: queuedTurn, inputs, attachments });
  }, [activeUploadCount, attachmentError, cancelQueued, queuedInputs, conversation.messages,
    options.conversationId, options.deliverMidRunMessage, queuedTurn, sendBlocker, sendGuardedPrompt, sendIntoRunningTurn]);

  const reset = useCallback(() => {
    submittedComposerRef.current = null;
    attachmentGenerationRef.current += 1;
    attachmentBatchIdRef.current = createChatLocalId({});
    for (const controller of activeUploadsRef.current) controller.abort();
    activeUploadsRef.current.clear();
    setActiveUploadCount(0);
    conversation.cancel();
    conversation.setMessages(options.initialMessages ?? []);
    composer.reset();
    setAttachmentError(null);
    setTypedAnswerNotice(null);
    typedAnswerGenerationRef.current += 1;
    // Without this, a prompt queued behind a streaming run survives `reset()` and — once
    // `conversation.cancel()` above clears the streaming blocker — the flush effect fires it into
    // the just-reset conversation instead of discarding it like the rest of this turn's state.
    queuedConversationIdRef.current = undefined;
    queuedForLiveDeliveryRef.current = false;
    queuedUploadOwnersRef.current.clear();
    setQueuedInputs([]);
    refusedSendRef.current = null;
  }, [composer, conversation, options.initialMessages]);

  return {
    secretRedacted: guard.secretRedacted,
    conversation,
    composer,
    selection,
    selectedAgent,
    agents: options.agents,
    activity,
    canSend,
    sendBlocker,
    isUploadingAttachments: activeUploadCount > 0,
    attachmentError,
    ...workingDirectoryState,
    setSelection,
    addAttachments,
    send,
    sendPrompt,
    retrySend,
    queuedPrompt: queuedTurn?.text ?? null,
    // Accepted live messages already have queued bubbles in the transcript. Their private fallback
    // copy must not create a second composer row whose Cancel button cannot revoke daemon input.
    queuedMessages: queuedInputs.filter(input => input.liveMessageId === undefined),
    cancelQueuedMessage,
    cancelQueued,
    typedAnswerNotice,
    sendAsNewMessage,
    interruptSend,
    reset,
  };
}
