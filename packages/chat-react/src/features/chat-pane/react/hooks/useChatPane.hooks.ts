import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  describeChatPaneSendBlocker,
  findChatPaneSendBlocker,
  resolveChatPaneSelection,
  type ChatPaneSendBlocker,
} from '../../rules.js';
import type {
  ChatPaneActivity,
  ChatPaneAgent,
  ChatPaneAttachmentUploadOptions,
  ChatPaneAgentSelection,
  ChatPaneRunContext,
  ChatPaneWorkingDirectoryAccess,
} from '../../types.js';
import type { ChatAttachment, ChatMessage } from '@jini/chat-core';
import type { ChatTransport } from '../../../../transport.js';
import { useComposer, type UseComposerResult } from '../../../../react/hooks/useComposer.js';
import {
  useConversation,
  type UseConversationResult,
} from '../../../../react/hooks/useConversation.js';
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
  workingDirectory?: string | null;
  initialWorkingDirectory?: string | null;
  onChangeWorkingDirectory?: (workingDirectory: string | null) => void;
  workingDirectoryAccess?: ChatPaneWorkingDirectoryAccess;
}

export interface UseChatPaneResult extends UseChatPaneWorkingDirectoryResult {
  conversation: UseConversationResult;
  composer: UseComposerResult;
  selection: ChatPaneAgentSelection;
  selectedAgent: ChatPaneAgent | undefined;
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
  reset: () => void;
}

function createAttachmentBatchId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function useChatPane(options: UseChatPaneOptions): UseChatPaneResult {
  const [activeUploadCount, setActiveUploadCount] = useState(0);
  const [attachmentError, setAttachmentError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  const attachmentGenerationRef = useRef(0);
  const attachmentBatchIdRef = useRef(createAttachmentBatchId());
  const activeUploadsRef = useRef(new Set<AbortController>());
  const [internalSelection, setInternalSelection] = useState<ChatPaneAgentSelection>(
    options.initialSelection ?? { agentId: '' },
  );
  const workingDirectoryState = useChatPaneWorkingDirectory({
    ...(options.workingDirectory === undefined
      ? {}
      : { workingDirectory: options.workingDirectory }),
    ...(options.initialWorkingDirectory === undefined
      ? {}
      : { initialWorkingDirectory: options.initialWorkingDirectory }),
    ...(options.onChangeWorkingDirectory === undefined
      ? {}
      : { onChangeWorkingDirectory: options.onChangeWorkingDirectory }),
    ...(options.workingDirectoryAccess === undefined
      ? {}
      : { workingDirectoryAccess: options.workingDirectoryAccess }),
  });
  const requestedSelection = options.selection ?? internalSelection;
  const selection = useMemo(
    () => resolveChatPaneSelection(options.agents, requestedSelection),
    [options.agents, requestedSelection],
  );
  const selectedAgent = options.agents.find((agent) => agent.id === selection.agentId);
  const composer = useComposer({
    ...(options.initialDraft === undefined ? {} : { initialDraft: options.initialDraft }),
    initialAgent: selection,
  });
  const conversation = useConversation({
    transport: options.transport,
    ...(options.initialMessages === undefined ? {} : { initialMessages: options.initialMessages }),
    ...(options.conversationId === undefined ? {} : { conversationId: options.conversationId }),
    ...(selection.agentId ? { agentId: selection.agentId } : {}),
  });

  const activity: ChatPaneActivity =
    selectedAgent === undefined
      ? 'unavailable'
      : conversation.error
        ? 'failed'
        : conversation.isStreaming
          ? 'streaming'
          : 'ready';

  useEffect(() => {
    options.onActivityChange?.(activity);
  }, [activity, options.onActivityChange]);

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
      const uploaded = await options.uploadAttachments(files, {
        signal: controller.signal,
        batchId: attachmentBatchIdRef.current,
      });
      if (
        !mountedRef.current
        || controller.signal.aborted
        || generation !== attachmentGenerationRef.current
      ) return;
      for (const attachment of uploaded) composer.addAttachment(attachment);
    } catch (error) {
      if (
        !mountedRef.current
        || controller.signal.aborted
        || generation !== attachmentGenerationRef.current
      ) return;
      setAttachmentError(error instanceof Error ? error : new Error(String(error)));
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
    await conversation.sendMessage(trimmed, {
      agentId: selection.agentId,
      ...(attachments.length === 0 ? {} : { attachments }),
      ...(context === undefined ? {} : { context }),
    });
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
    const prompt = composer.draft.trim()
      || (composer.attachments.length > 0 ? 'Review the attached file(s).' : '');
    if (!prompt || !canSend) return;
    await sendPrompt(prompt);
  }, [canSend, composer, sendPrompt]);

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
  }, [composer, conversation, options.initialMessages]);

  return {
    conversation,
    composer,
    selection,
    selectedAgent,
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
    reset,
  };
}
