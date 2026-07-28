/**
 * @module useComposer
 *
 * Owns the composer's draft text, staged attachments, `@`-mention popover
 * state, and the selected agent/model/sessionMode. Per
 * `foundry/docs/jini-port/recon/r4b-webui-design.md` §4: attachments reach the host
 * only through `ProjectContextValue.uploadFiles`/`ComposerSlots`; no direct
 * provider import. Draft persistence (OD's `ComposerDraftPort`,
 * localStorage-backed) is likewise injectable, not hard-wired — this hook
 * never touches `localStorage` itself; a host that wants persistence passes
 * `persistence` (falling back to in-memory/no persistence when omitted).
 *
 * Origin pattern: OD's `features/chat-composer/hooks/useComposerDraft.hooks.ts`
 * + `useComposerUpload.hooks.ts` + `useMentionPopover.hooks.ts` (branch
 * `refactor/web-chat-composer-slice-pr`), generalized: the Lexical-editor-ref
 * plumbing and localStorage port are OD/DOM-specific and dropped; the
 * draft/attachment/mention/agent-selection *state shape* is kept.
 */
import { useCallback, useMemo, useState } from 'react';
import type { ChatAttachment } from '@injini/chat-core';
import type { AgentSelection, ComposerSlots, MentionResult, ProjectContextValue } from '../../slots.js';

export interface ComposerDraftPersistence {
  read: () => string | null;
  write: (draft: string) => void;
}

export interface UseComposerOptions {
  initialDraft?: string;
  initialAgent?: AgentSelection;
  project?: ProjectContextValue;
  composerSlots?: ComposerSlots;
  persistence?: ComposerDraftPersistence;
}

export interface MentionPopoverState {
  open: boolean;
  query: string;
  results: MentionResult[];
}

export interface UseComposerResult {
  draft: string;
  setDraft: (next: string) => void;
  attachments: ChatAttachment[];
  /** Uploads via `project.uploadFiles` (when supplied) and stages the results; no-ops (with a rejected promise) when no upload port is wired. */
  addAttachments: (files: File[]) => Promise<void>;
  addAttachment: (attachment: ChatAttachment) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  agent: AgentSelection | undefined;
  setAgent: (next: AgentSelection) => void;
  mention: MentionPopoverState;
  openMention: (query: string) => Promise<void>;
  closeMention: () => void;
  /** Applies a picked mention result to the draft (appends `insertText` or `@label`), then closes the popover. */
  selectMention: (result: MentionResult) => void;
  /** `true` once the draft has content or an attachment — a `<Composer>` gates its send button on this. */
  canSubmit: boolean;
  /** Clears the draft and staged attachments (called after a successful send). */
  reset: () => void;
}

const EMPTY_MENTION: MentionPopoverState = { open: false, query: '', results: [] };

export function useComposer(options: UseComposerOptions = {}): UseComposerResult {
  const { project, composerSlots, persistence } = options;
  const [draft, setDraftState] = useState<string>(() => options.initialDraft ?? persistence?.read() ?? '');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [agent, setAgent] = useState<AgentSelection | undefined>(options.initialAgent);
  const [mention, setMention] = useState<MentionPopoverState>(EMPTY_MENTION);

  const setDraft = useCallback(
    (next: string) => {
      setDraftState(next);
      persistence?.write(next);
    },
    [persistence],
  );

  const addAttachment = useCallback((attachment: ChatAttachment) => {
    setAttachments((prev) => [...prev, attachment]);
  }, []);

  const addAttachments = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      if (!project?.uploadFiles) {
        throw new Error('addAttachments requires ProjectContextValue.uploadFiles to be wired by the host');
      }
      const uploaded = await project.uploadFiles(files);
      setAttachments((prev) => [...prev, ...uploaded]);
      for (const a of uploaded) composerSlots?.onAttach?.(a);
    },
    [composerSlots, project],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.path !== id));
  }, []);

  const clearAttachments = useCallback(() => setAttachments([]), []);

  const openMention = useCallback(
    async (query: string) => {
      setMention({ open: true, query, results: [] });
      const sources = composerSlots?.mentionSources ?? [];
      if (sources.length === 0) return;
      const results = (
        await Promise.all(
          sources.map(async (source) => {
            try {
              return await source.search(query);
            } catch {
              return [];
            }
          }),
        )
      ).flat();
      setMention((prev) => (prev.open && prev.query === query ? { ...prev, results } : prev));
    },
    [composerSlots],
  );

  const closeMention = useCallback(() => setMention(EMPTY_MENTION), []);

  const selectMention = useCallback(
    (result: MentionResult) => {
      const insertion = result.insertText ?? `@${result.label} `;
      setDraft(`${draft}${insertion}`);
      setMention(EMPTY_MENTION);
    },
    [draft, setDraft],
  );

  const reset = useCallback(() => {
    setDraft('');
    clearAttachments();
    closeMention();
  }, [clearAttachments, closeMention, setDraft]);

  const canSubmit = draft.trim().length > 0 || attachments.length > 0;

  return useMemo(
    () => ({
      draft,
      setDraft,
      attachments,
      addAttachments,
      addAttachment,
      removeAttachment,
      clearAttachments,
      agent,
      setAgent,
      mention,
      openMention,
      closeMention,
      selectMention,
      canSubmit,
      reset,
    }),
    [draft, setDraft, attachments, addAttachments, addAttachment, removeAttachment, clearAttachments, agent, mention, openMention, closeMention, selectMention, canSubmit, reset],
  );
}
