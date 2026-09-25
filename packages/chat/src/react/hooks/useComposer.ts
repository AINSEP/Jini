/**
 * @module useComposer
 *
 * Owns the composer's draft text, staged attachments, `@`-mention popover
 * state, and the selected agent/model/sessionMode. Per
 * `ADS-memory/reports/jini-port/recon/r4b-webui-design.md` §4: attachments reach the host
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
 *
 * `conversationId` (when supplied) keys the draft — and, on a change, the staged attachments and
 * mention popover — against `composer-draft-cache.ts`, so whatever was typed comes back on a switch
 * between conversations, on a `ChatPane` remount, and on a full page reload, without leaking into
 * the wrong conversation. That cache is a separate, always-on mechanism from `persistence` above,
 * which stays an opt-in host-owned slot this hook never touches directly and which still wins at
 * mount when a host wires one; the cache needs no host wiring and is what actually fixes the
 * reported data loss (see its module doc). Staged attachments and the mention popover are
 * deliberately NOT cached across a switch (unlike the draft text): they reference an in-flight
 * upload batch, and carrying them into a different conversation risks attaching the wrong files to
 * the wrong thread, so they are cleared instead.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatAttachment } from '../../core/index.js';
import {
  readCachedAttachments,
  readCachedDraft,
  writeCachedAttachments,
  writeCachedDraft,
} from './composer-draft-cache.js';
import { cacheAttachmentPreviewSource } from './attachment-preview-cache.js';
import type { AgentSelection, ComposerSlots, MentionResult, ProjectContextValue } from '../slots.js';

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
  /**
   * The active conversation, used to key the per-conversation draft cache (see this module's doc).
   * `null`/absent (an untitled, not-yet-created conversation) opts out of caching entirely — there is
   * nothing to key on yet, and the draft lives only in this hook's own React state until an id
   * exists.
   */
  conversationId?: string | null;
  /**
   * Confirms which of a conversation's previously staged attachments still exist, so a restored
   * draft never shows a chip for a file the host has since garbage-collected — that looks intact and
   * then fails at send, which is worse than not restoring it at all.
   *
   * Receives the cached references and returns the subset still valid (order need not be preserved;
   * an empty array means none survived). A rejection is treated as "none survived" — restoring
   * unverified references is the failure mode this option exists to prevent.
   *
   * **Omitting it disables attachment persistence entirely** — nothing is written and nothing is
   * restored, which is exactly the behavior before this option existed. Only the draft TEXT is
   * persisted then, so a host that cannot answer the liveness question loses nothing and risks
   * nothing. Text and attachments are stored under separate keys and degrade independently.
   *
   * Captured in a ref, so an inline arrow is safe and will not re-run the restore on every render.
   */
  validateAttachments?: (attachments: readonly ChatAttachment[]) => Promise<readonly ChatAttachment[]>;
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
  const { project, composerSlots, persistence, conversationId, validateAttachments } = options;
  const [draft, setDraftState] = useState<string>(
    () => options.initialDraft ?? persistence?.read() ?? readCachedDraft(conversationId) ?? '',
  );
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [agent, setAgent] = useState<AgentSelection | undefined>(options.initialAgent);
  const [mention, setMention] = useState<MentionPopoverState>(EMPTY_MENTION);

  const setDraft = useCallback(
    (next: string) => {
      setDraftState(next);
      persistence?.write(next);
      writeCachedDraft(conversationId, next);
    },
    [persistence, conversationId],
  );

  // Lets the conversation-change effect below read the live draft without taking `draft` as a
  // dependency, which would re-run it on every keystroke.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Re-keys the draft (and drops attachments/the mention popover — see this module's doc) when
  // `conversationId` changes WITHOUT a remount — a host that keeps the composer mounted across
  // conversations, unlike a host that remounts `ChatPane` via a conversation-keyed `key` (the
  // `useState` initializer above already handles that case at mount time). Skips the very first
  // render via the ref comparison so it never fights that initializer.
  const previousConversationIdRef = useRef(conversationId);
  useEffect(() => {
    const previousConversationId = previousConversationIdRef.current;
    if (conversationId === previousConversationIdRef.current) return;
    previousConversationIdRef.current = conversationId;
    const restored = readCachedDraft(conversationId);

    // An id arriving where there was none is NOT a switch between two conversations — it is the one
    // the operator is already looking at finally getting a key (a new chat created server-side
    // mid-compose, or a host that resolves the active id asynchronously after mount). Adopt what
    // they have typed instead of wiping it: writes no-op while the id is absent, so that text
    // exists in this hook's state and nowhere else, and an empty restore must never clobber text
    // the person can currently see. Guarded to `previousConversationId == null` so a real
    // conversation-to-conversation switch still clears, and cannot leak one thread's half-written
    // message into another. Attachments and the mention popover are left alone here for the same
    // reason — nothing was switched away from.
    if (previousConversationId == null && conversationId != null && restored === null && draftRef.current.trim() !== '') {
      writeCachedDraft(conversationId, draftRef.current);
      return;
    }

    setDraftState(restored ?? '');
    setAttachments([]);
    setMention(EMPTY_MENTION);
  }, [conversationId]);

  // Held in a ref so an inline arrow from the host does not re-run the restore below on every
  // render. Reassigned each render so a host that swaps implementations still gets the new one.
  const validateAttachmentsRef = useRef(validateAttachments);
  validateAttachmentsRef.current = validateAttachments;

  // Which conversation the attachment restore has already settled for. Compared against the live
  // `conversationId` before any persist, so the switch effect's own `setAttachments([])` can never
  // race ahead and delete the conversation being switched TO. `undefined` means "not settled yet",
  // which is why this is not a boolean.
  const attachmentsHydratedForRef = useRef<string | null | undefined>(undefined);

  // Restores previously staged attachments, but only ones the host confirms still exist. Without a
  // validator this does nothing at all: attachment persistence stays off and only the draft text
  // survives, which is the documented default (see `validateAttachments`).
  useEffect(() => {
    const validate = validateAttachmentsRef.current;
    if (!validate || !conversationId) {
      attachmentsHydratedForRef.current = conversationId;
      return;
    }
    const cached = readCachedAttachments(conversationId);
    if (cached === null || cached.length === 0) {
      attachmentsHydratedForRef.current = conversationId;
      return;
    }
    let cancelled = false;
    void (async () => {
      let valid: readonly ChatAttachment[] = [];
      try {
        valid = await validate(cached);
      } catch {
        // A validator that throws tells us nothing about the files, so assume none survived rather
        // than restoring references we cannot vouch for.
        valid = [];
      }
      if (cancelled) return;
      if (valid.length > 0) {
        // Only seeds an untouched composer: anything the operator staged while validation was in
        // flight is theirs and outranks a restore.
        setAttachments((prev) => (prev.length === 0 ? [...valid] : prev));
      } else {
        // Every reference was dead. Purge them so the next load does not pay for this again.
        writeCachedAttachments(conversationId, []);
      }
      attachmentsHydratedForRef.current = conversationId;
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // Persists staged attachments once the restore for THIS conversation has settled. Gated on the
  // settle marker so a mount's initial empty `attachments` cannot delete what is still being
  // restored. An empty list deletes the entry, so a send (which clears attachments) also clears the
  // cached references, matching the draft text's own rule.
  useEffect(() => {
    if (!validateAttachmentsRef.current || !conversationId) return;
    if (attachmentsHydratedForRef.current !== conversationId) return;
    writeCachedAttachments(conversationId, attachments);
  }, [attachments, conversationId]);

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
      // `uploadFiles` resolves 1:1 with `files`, in order, on success (see
      // `create-daemon-attachment-uploader.ts`'s "preserved order" doc) - any failure rejects the
      // whole call instead of returning a short array, so this zip never pairs the wrong bytes with
      // the wrong attachment. Caching the original `File` here, at the one moment this hook already
      // holds it, is what lets `AttachmentPreviewModal` show it again later - see
      // `attachment-preview-cache.ts`'s module doc for why the server cannot hand it back.
      uploaded.forEach((a, i) => {
        const file = files[i];
        if (file) cacheAttachmentPreviewSource(a.path, file);
      });
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
