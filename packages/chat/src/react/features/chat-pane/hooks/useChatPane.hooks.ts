import type { UserTextRedaction, UserTextRedactionOptions } from '../../../../core/user-text-redaction.js';
import { useUserTextGuard } from '../../../hooks/useUserTextGuard.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  describeChatPaneSendBlocker,
  findAwaitedTypedAnswerId,
  findChatPaneSendBlocker,
  isChatPaneQueueableBlocker,
  isTypedAnswerTurn,
  resolveChatPaneSelection,
  type ChatPaneSendBlocker,
} from '../rules.js';
import type {
  ChatPaneActivity,
  ChatPaneAgent,
  ChatPaneAttachmentUploadOptions,
  ChatPaneAgentSelection,
  ChatPaneRunContext,
  ChatPaneWorkingDirectoryAccess,
  DeliverTypedAnswer,
  TypedAnswerDelivery,
  TypedAnswerNotice,
} from '../types.js';
import type { ChatAttachment, ChatMessage } from '@jini-ai/chat';
import type { ComposerHistoryStoragePort } from '../../../../core/composer-history.js';
import type { ChatTransport } from '@jini-ai/chat';
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
  conversationId?: string | null;
  initialSelection?: ChatPaneAgentSelection;
  selection?: ChatPaneAgentSelection;
  onSelectionChange?: (selection: ChatPaneAgentSelection) => void;
  runContext?: ChatPaneRunContext;
  initialDraft?: string;
  composerHistoryScope?: string;
  composerHistoryStorage?: ComposerHistoryStoragePort;
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
   * The prompt waiting for the in-flight run to finish, or `null` when nothing is queued. Exposed
   * so the pane can SHOW it — a queued turn that is invisible is indistinguishable from one that
   * was silently swallowed.
   */
  queuedPrompt: string | null;
  /** Drops the queued prompt without ever sending it. */
  cancelQueued: () => void;
  /**
   * Why the last typed answer was NOT sent, or `null`. Set when `deliverTypedAnswer` reports the
   * question no longer waiting or could not be reached, and when {@link send} holds back an answer
   * whose question has since closed; the draft stays in the composer. Cleared by the next send and
   * by `reset()`.
   */
  typedAnswerNotice: TypedAnswerNotice | null;
  /**
   * Sends the composer draft as an ordinary next turn (queued behind a running run, as {@link send}
   * does) even though it was typed as an answer to a question that has since closed. The one way
   * past {@link send}'s hold on such a draft other than clearing it: the human chose a new, possibly
   * paid, run on purpose.
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
 * The prompt a composer-driven send would carry: the trimmed draft, or a stand-in when only
 * attachments are staged. Module scope so `send()` and `interruptSend()` cannot drift apart on
 * what counts as sendable.
 */
function composerPrompt(composer: UseComposerResult): string {
  return composer.draft.trim()
    || (composer.attachments.length > 0 ? 'Review the attached file(s).' : '');
}

function createAttachmentBatchId(): string {
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
  // Keep the signal with sanitized queue text; re-redacting it later cannot detect the original paste.
  const [queuedTurn, setQueuedTurn] = useState<UserTextRedaction | null>(null);
  const [typedAnswerNotice, setTypedAnswerNotice] = useState<TypedAnswerNotice | null>(null);
  // Set across the await of one typed-answer delivery so a second Enter cannot post the same text
  // twice — the second post would find the question already answered and wrongly report it closed.
  const deliveringTypedAnswerRef = useRef(false);
  // The question (tool-use id) the current draft was typed for, or null. Set while a non-empty draft
  // sits in the composer as a question waits, and kept after that question closes (answered
  // elsewhere, expired, 409), so `send` cannot slip the draft into the queue as a new paid run.
  // Released only by an empty draft, a delivery, `reset()`, or `sendAsNewMessage`.
  const heldAnswerQuestionIdRef = useRef<string | null>(null);
  // The question the last delivery answered: typing more while its card is still drawn open (its
  // tool_result has not streamed in yet) is a follow-up, not another answer to hold.
  const answeredQuestionIdRef = useRef<string | null>(null);
  // Bumped by `reset()` and a conversation switch; a delivery that settles under a different value
  // belongs to a composer that no longer exists and must neither clear the draft nor set a notice.
  const typedAnswerGenerationRef = useRef(0);
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
    () => readCachedAttachmentBatchId({ conversationId: options.conversationId }) ?? createAttachmentBatchId(),
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
  const selection = useMemo(
    () => resolveChatPaneSelection({ agents: options.agents, requested: requestedSelection }),
    [options.agents, requestedSelection],
  );
  const selectedAgent = options.agents.find((agent) => agent.id === selection.agentId);
  const conversation = useConversation(definedProps({ source: {
    transport: options.transport,
    redactUserText: options.redactUserText,
    onSecretRedacted: guard.notifyRedaction,
    initialMessages: options.initialMessages,
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
    initialAgent: selection,
    conversationId: options.conversationId,
    validateAttachments: options.validateAttachments,
  } }));

  const activity: ChatPaneActivity = resolveChatPaneActivity(selectedAgent, conversation);

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

  useEffect(() => {
    if (!selection.agentId) return;
    if (
      requestedSelection.agentId === selection.agentId
      && requestedSelection.model === selection.model
      && requestedSelection.reasoning === selection.reasoning
    ) return;
    if (options.selection === undefined) setInternalSelection(selection);
    composer.setAgent(selection);
    options.onSelectionChange?.(selection);
  }, [
    composer,
    options.onSelectionChange,
    options.selection,
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
  const latestDraftRef = useRef(composer.draft);
  latestDraftRef.current = composer.draft;
  const awaitedQuestionId = options.deliverTypedAnswer === undefined
    ? null
    : findAwaitedTypedAnswerId({ messages: conversation.messages, toolName: options.deliverTypedAnswer.toolName });
  const hasDraft = composer.draft.trim() !== '';

  useEffect(() => {
    if (!hasDraft) {
      heldAnswerQuestionIdRef.current = null;
      return;
    }
    if (awaitedQuestionId !== null && awaitedQuestionId !== answeredQuestionIdRef.current) {
      heldAnswerQuestionIdRef.current = awaitedQuestionId;
    }
  }, [awaitedQuestionId, hasDraft]);

  useEffect(() => {
    typedAnswerGenerationRef.current += 1;
    heldAnswerQuestionIdRef.current = null;
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
    attachmentBatchIdRef.current = createAttachmentBatchId();
  }, [options.conversationId]);

  const addAttachments = useCallback(async (files: File[]) => {
    if (files.length === 0 || options.uploadAttachments === undefined) return;
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
          composer.addAttachment(attachment);
          if (file) cacheAttachmentPreviewSource({ path: attachment.path, file });
        },
        onError: setAttachmentError,
      });
    } finally {
      if (activeUploadsRef.current.delete(controller) && mountedRef.current) {
        setActiveUploadCount(activeUploadsRef.current.size);
      }
    }
  }, [composer, options.conversationId, options.uploadAttachments]);

  const sendGuardedPrompt = useCallback(async ({ redaction }: { redaction: UserTextRedaction }, _optional = {}) => {
    const trimmed = redaction.text.trim();
    if (!trimmed) throw new Error('cannot send: the prompt is empty');
    if (sendBlocker !== null) {
      throw new Error(`cannot send: ${describeChatPaneSendBlocker(sendBlocker)}`);
    }
    const attachments = composer.attachments;
    const context = typeof options.runContext === 'function'
      ? options.runContext({
          prompt: trimmed,
          selection,
          workingDirectory: workingDirectoryState.workingDirectory,
        })
      : options.runContext;
    composer.reset();
    attachmentGenerationRef.current += 1;
    attachmentBatchIdRef.current = createAttachmentBatchId();
    options.onActivityChange?.('queued');
    await conversation.sendMessage(trimmed, definedProps({ source: {
      secretRedaction: redaction.secretRedacted ? { secretRedacted: true as const, count: redaction.count } : undefined,
      agentId: selection.agentId,
      // Omitted when the array is EMPTY, not merely absent — an empty `attachments: []` would be a
      // different (valid, present) value to the transport than "no attachments key at all".
      attachments: attachments.length === 0 ? undefined : attachments,
      context,
    } }));
  }, [
    composer,
    conversation,
    options.onActivityChange,
    options.runContext,
    selection,
    sendBlocker,
    workingDirectoryState.workingDirectory,
  ]);

  const sendPrompt = useCallback(async (prompt: string) => {
    await sendGuardedPrompt({ redaction: guard.redact({ text: prompt.trim() }, {}) }, {});
  }, [guard.redact, sendGuardedPrompt]);

  const answerWaitingQuestion = useCallback(async (
    { deliver, text }: { deliver: DeliverTypedAnswer; text: string },
  ) => {
    const safeText = guard.redactText(text);
    const generation = typedAnswerGenerationRef.current;
    const submittedDraft = latestDraftRef.current;
    const questionId = awaitedQuestionId;
    deliveringTypedAnswerRef.current = true;
    const outcome = await deliverTypedAnswerSafely({ deliver, text: safeText });
    deliveringTypedAnswerRef.current = false;
    if (!mountedRef.current || generation !== typedAnswerGenerationRef.current) return;
    // Anything but a delivery keeps the draft and says why — never the queue below, whose flush
    // would post the answer as a brand-new (paid) run once this one ends.
    if (outcome !== 'delivered') {
      setTypedAnswerNotice(outcome);
      return;
    }
    answeredQuestionIdRef.current = questionId;
    heldAnswerQuestionIdRef.current = null;
    // The textarea stays editable during delivery: clear only the text that went out, never a
    // correction or next message typed while the host answered.
    if (latestDraftRef.current === submittedDraft) composer.setDraft('');
  }, [awaitedQuestionId, composer, guard.redactText]);

  // The ordinary next-turn path: queue behind a running run, else send now.
  const sendOrdinaryTurn = useCallback(async (prompt: string) => {
    // Queue instead of no-op'ing. `setDraft('')` and NOT `composer.reset()`: reset also discards
    // staged attachments, which this turn still needs when it finally goes out.
    if (isChatPaneQueueableBlocker({ blocker: sendBlocker })) {
      queuedConversationIdRef.current = options.conversationId;
      setQueuedTurn(guard.redact({ text: prompt }, {}));
      composer.setDraft('');
      return;
    }
    if (!canSend) return;
    await sendPrompt(prompt);
  }, [canSend, composer, options.conversationId, sendBlocker, sendPrompt, guard.redact]);

  const send = useCallback(async () => {
    const prompt = composerPrompt(composer);
    if (!prompt || deliveringTypedAnswerRef.current) return;
    setTypedAnswerNotice(null);
    const deliver = options.deliverTypedAnswer;
    if (deliver !== undefined && isTypedAnswerTurn({
      blocker: sendBlocker,
      attachmentCount: composer.attachments.length,
      messages: conversation.messages,
      toolName: deliver.toolName,
    })) {
      await answerWaitingQuestion({ deliver, text: prompt });
      return;
    }
    // Typed for a question that has since closed: the human meant an answer, so going on to the
    // queue would start a paid run they never asked for. Attachments mark a new turn (a typed answer
    // carries text only), the same rule `isTypedAnswerTurn` applies.
    if (heldAnswerQuestionIdRef.current !== null && composer.attachments.length === 0) {
      setTypedAnswerNotice('not-pending');
      return;
    }
    await sendOrdinaryTurn(prompt);
  }, [
    answerWaitingQuestion,
    composer,
    conversation.messages,
    options.deliverTypedAnswer,
    sendBlocker,
    sendOrdinaryTurn,
  ]);

  const sendAsNewMessage = useCallback(async () => {
    const prompt = composerPrompt(composer);
    if (!prompt || deliveringTypedAnswerRef.current) return;
    setTypedAnswerNotice(null);
    // Mark the question answered too, so the still-non-empty draft is not re-held by the effect
    // while that question's card is drawn open.
    answeredQuestionIdRef.current = heldAnswerQuestionIdRef.current ?? answeredQuestionIdRef.current;
    heldAnswerQuestionIdRef.current = null;
    await sendOrdinaryTurn(prompt);
  }, [composer, sendOrdinaryTurn]);

  const interruptSend = useCallback(() => {
    const prompt = composerPrompt(composer);
    if (!prompt) return;
    queuedConversationIdRef.current = options.conversationId;
    setQueuedTurn(guard.redact({ text: prompt }, {}));
    composer.setDraft('');
    conversation.cancel();
  }, [composer, conversation, options.conversationId, guard.redact]);

  const cancelQueued = useCallback(() => {
    queuedConversationIdRef.current = undefined;
    setQueuedTurn(null);
  }, []);

  // Flush on a FULLY clear blocker, not merely on streaming ending — see
  // `isChatPaneQueueableBlocker`'s note about `findChatPaneSendBlocker`'s ordering. Clearing the
  // queue slot BEFORE awaiting keeps a re-render from double-sending the same prompt.
  useEffect(() => {
    if (queuedTurn === null || sendBlocker !== null) return;
    if (queuedConversationIdRef.current !== options.conversationId) {
      // The conversation changed while this prompt waited behind a streaming run — sending it now
      // would post it into a conversation the user never saw it queued against. Drop it instead
      // (same as `cancelQueued`) rather than misrouting it.
      queuedConversationIdRef.current = undefined;
      setQueuedTurn(null);
      return;
    }
    setQueuedTurn(null);
    void sendGuardedPrompt({ redaction: queuedTurn }, {});
  }, [options.conversationId, queuedTurn, sendBlocker, sendGuardedPrompt]);

  const reset = useCallback(() => {
    attachmentGenerationRef.current += 1;
    attachmentBatchIdRef.current = createAttachmentBatchId();
    for (const controller of activeUploadsRef.current) controller.abort();
    activeUploadsRef.current.clear();
    setActiveUploadCount(0);
    conversation.cancel();
    conversation.setMessages(options.initialMessages ?? []);
    composer.reset();
    setAttachmentError(null);
    setTypedAnswerNotice(null);
    typedAnswerGenerationRef.current += 1;
    heldAnswerQuestionIdRef.current = null;
    // Without this, a prompt queued behind a streaming run survives `reset()` and — once
    // `conversation.cancel()` above clears the streaming blocker — the flush effect fires it into
    // the just-reset conversation instead of discarding it like the rest of this turn's state.
    queuedConversationIdRef.current = undefined;
    setQueuedTurn(null);
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
    queuedPrompt: queuedTurn?.text ?? null,
    cancelQueued,
    typedAnswerNotice,
    sendAsNewMessage,
    interruptSend,
    reset,
  };
}
