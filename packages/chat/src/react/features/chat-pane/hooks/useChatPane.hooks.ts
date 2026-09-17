import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  describeChatPaneSendBlocker,
  findChatPaneSendBlocker,
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
  ChatPaneWorkingDirectoryAccess,
} from '../types.js';
import type { ChatAttachment, ChatMessage } from '@jini-ai/chat';
import type { ChatTransport } from '@jini-ai/chat';
import { definedProps } from '../../../util/defined-props.js';
import { cacheAttachmentPreviewSource } from '../../../hooks/attachment-preview-cache.js';
import { useComposer, type UseComposerResult } from '../../../hooks/useComposer.js';
import {
  useConversation,
  type UseConversationResult,
} from '../../../hooks/useConversation.js';
import {
  useChatPaneWorkingDirectory,
  type UseChatPaneWorkingDirectoryResult,
} from './useChatPaneWorkingDirectory.hooks.js';

export interface UseChatPaneOptions {
  transport: ChatTransport;
  agents: readonly ChatPaneAgent[];
  initialMessages?: ChatMessage[];
  conversationId?: string | null;
  initialSelection?: ChatPaneAgentSelection;
  selection?: ChatPaneAgentSelection;
  onSelectionChange?: (selection: ChatPaneAgentSelection) => void;
  runContext?: ChatPaneRunContext;
  initialDraft?: string;
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
}

export interface UseChatPaneResult extends UseChatPaneWorkingDirectoryResult {
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
  const [activeUploadCount, setActiveUploadCount] = useState(0);
  const [attachmentError, setAttachmentError] = useState<Error | null>(null);
  const [queuedPrompt, setQueuedPrompt] = useState<string | null>(null);
  // The conversation `queuedPrompt` was queued against. Compared with `options.conversationId` at
  // flush time so a prompt queued behind a streaming run in one conversation can never be posted
  // into a different one the caller switched to before that run finished.
  const queuedConversationIdRef = useRef<string | null | undefined>(undefined);
  const mountedRef = useRef(true);
  const attachmentGenerationRef = useRef(0);
  const attachmentBatchIdRef = useRef(createAttachmentBatchId());
  const activeUploadsRef = useRef(new Set<AbortController>());
  const [internalSelection, setInternalSelection] = useState<ChatPaneAgentSelection>(
    options.initialSelection ?? { agentId: '' },
  );
  const workingDirectoryState = useChatPaneWorkingDirectory(definedProps({
    workingDirectory: options.workingDirectory,
    initialWorkingDirectory: options.initialWorkingDirectory,
    onChangeWorkingDirectory: options.onChangeWorkingDirectory,
    workingDirectoryAccess: options.workingDirectoryAccess,
  }));
  const requestedSelection = options.selection ?? internalSelection;
  const selection = useMemo(
    () => resolveChatPaneSelection(options.agents, requestedSelection),
    [options.agents, requestedSelection],
  );
  const selectedAgent = options.agents.find((agent) => agent.id === selection.agentId);
  const composer = useComposer(definedProps({
    initialDraft: options.initialDraft,
    initialAgent: selection,
    conversationId: options.conversationId,
  }));
  const conversation = useConversation(definedProps({
    transport: options.transport,
    initialMessages: options.initialMessages,
    conversationId: options.conversationId,
    // Keys off an empty string, not `undefined` — `selection.agentId` is always a string (never
    // absent), so only the falsy "no agent selected" case should omit the key.
    agentId: selection.agentId || undefined,
  }));

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
    const validated = resolveChatPaneSelection(options.agents, next);
    setInternalSelection(validated);
    composer.setAgent(validated);
    options.onSelectionChange?.(validated);
  }, [composer, options.agents, options.onSelectionChange]);

  const sendBlocker = findChatPaneSendBlocker({
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

  const addAttachments = useCallback(async (files: File[]) => {
    if (files.length === 0 || options.uploadAttachments === undefined) return;
    const generation = attachmentGenerationRef.current;
    const controller = new AbortController();
    activeUploadsRef.current.add(controller);
    setActiveUploadCount(activeUploadsRef.current.size);
    setAttachmentError(null);
    try {
      await uploadAttachmentBatch(files, {
        upload: options.uploadAttachments,
        signal: controller.signal,
        batchId: attachmentBatchIdRef.current,
        stillWanted: () => mountedRef.current
          && !controller.signal.aborted
          && generation === attachmentGenerationRef.current,
        // Caches the original `File` right here, at the one point this closure has both it and the
        // resulting `ChatAttachment` paired — mirrors `useComposer.ts`'s own `addAttachments`, which
        // does the same pairing for its (separate, currently unused-in-production) upload path. See
        // `attachment-preview-cache.ts`'s module doc for why this is the only place that copy can
        // ever be captured.
        onAttachment: (attachment, file) => {
          composer.addAttachment(attachment);
          if (file) cacheAttachmentPreviewSource(attachment.path, file);
        },
        onError: setAttachmentError,
      });
    } finally {
      if (activeUploadsRef.current.delete(controller) && mountedRef.current) {
        setActiveUploadCount(activeUploadsRef.current.size);
      }
    }
  }, [composer, options.uploadAttachments]);

  const sendPrompt = useCallback(async (prompt: string) => {
    const trimmed = prompt.trim();
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
    await conversation.sendMessage(trimmed, definedProps({
      agentId: selection.agentId,
      // Omitted when the array is EMPTY, not merely absent — an empty `attachments: []` would be a
      // different (valid, present) value to the transport than "no attachments key at all".
      attachments: attachments.length === 0 ? undefined : attachments,
      context,
    }));
  }, [
    composer,
    conversation,
    options.onActivityChange,
    options.runContext,
    selection,
    sendBlocker,
    workingDirectoryState.workingDirectory,
  ]);

  const send = useCallback(async () => {
    const prompt = composerPrompt(composer);
    if (!prompt) return;
    // Queue instead of no-op'ing. `setDraft('')` and NOT `composer.reset()`: reset also discards
    // staged attachments, which this turn still needs when it finally goes out.
    if (isChatPaneQueueableBlocker(sendBlocker)) {
      queuedConversationIdRef.current = options.conversationId;
      setQueuedPrompt(prompt);
      composer.setDraft('');
      return;
    }
    if (!canSend) return;
    await sendPrompt(prompt);
  }, [canSend, composer, options.conversationId, sendBlocker, sendPrompt]);

  const interruptSend = useCallback(() => {
    const prompt = composerPrompt(composer);
    if (!prompt) return;
    queuedConversationIdRef.current = options.conversationId;
    setQueuedPrompt(prompt);
    composer.setDraft('');
    conversation.cancel();
  }, [composer, conversation, options.conversationId]);

  const cancelQueued = useCallback(() => {
    queuedConversationIdRef.current = undefined;
    setQueuedPrompt(null);
  }, []);

  // Flush on a FULLY clear blocker, not merely on streaming ending — see
  // `isChatPaneQueueableBlocker`'s note about `findChatPaneSendBlocker`'s ordering. Clearing the
  // queue slot BEFORE awaiting keeps a re-render from double-sending the same prompt.
  useEffect(() => {
    if (queuedPrompt === null || sendBlocker !== null) return;
    if (queuedConversationIdRef.current !== options.conversationId) {
      // The conversation changed while this prompt waited behind a streaming run — sending it now
      // would post it into a conversation the user never saw it queued against. Drop it instead
      // (same as `cancelQueued`) rather than misrouting it.
      queuedConversationIdRef.current = undefined;
      setQueuedPrompt(null);
      return;
    }
    setQueuedPrompt(null);
    void sendPrompt(queuedPrompt);
  }, [options.conversationId, queuedPrompt, sendBlocker, sendPrompt]);

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
    // Without this, a prompt queued behind a streaming run survives `reset()` and — once
    // `conversation.cancel()` above clears the streaming blocker — the flush effect fires it into
    // the just-reset conversation instead of discarding it like the rest of this turn's state.
    queuedConversationIdRef.current = undefined;
    setQueuedPrompt(null);
  }, [composer, conversation, options.initialMessages]);

  return {
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
    queuedPrompt,
    cancelQueued,
    interruptSend,
    reset,
  };
}
