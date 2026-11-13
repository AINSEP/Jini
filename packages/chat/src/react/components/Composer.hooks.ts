import { formatErrorForLog } from '@jini-ai/core';
import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type CSSProperties, type KeyboardEvent } from 'react';
import { useComposerHistoryKeys } from '../hooks/useComposerHistoryKeys.hooks.js';
import type { ComposerDiscoveryGroup, ComposerDiscoveryItem, ComposerDiscoveryOutcome } from '../slots.js';
import type { ComposerProps } from './Composer.js';
import { appendComposerDiscovery, composerDiscoveryMenuPosition, composerSlashMenuPosition, filterComposerDiscovery, parseComposerSlashQuery, replaceComposerSlashTrigger, resolveComposerSlashInvocation, resolveComposerSlashKeyAction } from './composer-discovery.js';

function reportComposerHostEffectFailure({ effectName, error }: { effectName: string; error: unknown }, _options = {}) {
  console.error(`[@jini-ai/chat] Composer ${effectName} host effect failed:`, formatErrorForLog({ error }));
}

/**
 * Invokes host code synchronously, then observes either its synchronous result or async failure.
 *
 * @param onResolved - Optional, called with the host's resolved (non-thrown/non-rejected) return
 * value — never called after a synchronous throw or an async rejection. Added for
 * `onDiscoverySelect`, whose {@link ComposerDiscoveryOutcome} return value the caller applies to
 * the draft; the two other host effects this function backs (`plusMenuItems.onSelect`,
 * `attachmentPicker.onFiles`) simply omit it, which reproduces their exact prior behavior.
 */
export function runComposerHostEffect(
  { effectName, effect }: { effectName: string; effect: () => unknown },
  { onSettled, onResolved }: { onSettled?: () => void; onResolved?: (result: unknown) => void } = {},
) {
  let result: unknown;
  try {
    result = effect();
  } catch (error) {
    reportComposerHostEffectFailure({ effectName, error });
    onSettled?.();
    return;
  }

  const asynchronous = result !== undefined;
  if (!asynchronous) {
    onResolved?.(result);
    onSettled?.();
  }
  void Promise.resolve(result)
    .then((resolved) => {
      if (asynchronous) onResolved?.(resolved);
    })
    .catch((error: unknown) => {
      reportComposerHostEffectFailure({ effectName, error });
    })
    .finally(() => {
      if (asynchronous) onSettled?.();
    });
}

/** Coordinate composer menus, keyboard handling, attachments, and host effects. */
export function useComposerView({ composer, slots, attachmentPicker, workingDirectory, onChangeWorkingDirectory, disabled, sendDisabled, onInterrupt, onSend }: {
  composer: ComposerProps['composer']; slots: ComposerProps['slots']; attachmentPicker: ComposerProps['attachmentPicker'];
  workingDirectory: ComposerProps['workingDirectory']; onChangeWorkingDirectory: ComposerProps['onChangeWorkingDirectory'];
  disabled: boolean; sendDisabled: boolean; onInterrupt: ComposerProps['onInterrupt']; onSend: ComposerProps['onSend'];
}, _options = {}) {
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const discoveryEffectInFlightRef = useRef(false);
  /**
   * Mirrors `composer.draft` for the ONE place it must be read outside a render: inside
   * `notifyDiscovery`'s `onResolved` callback, which can fire after arbitrarily many re-renders
   * (nothing here disables the textarea while a host effect is in flight, so the user is free to
   * keep typing). Reassigned every render rather than via an effect — an effect would lag one
   * render behind the value it needs to be compared against at the exact moment the outcome
   * settles.
   */
  const draftRef = useRef(composer.draft);
  draftRef.current = composer.draft;
  const [discoveryMenuOpen, setDiscoveryMenuOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [dismissedSlashDraft, setDismissedSlashDraft] = useState<string | null>(null);
  const [discoveryMenuPosition, setDiscoveryMenuPosition] = useState<CSSProperties>();
  const [slashMenuPosition, setSlashMenuPosition] = useState<CSSProperties>();
  const [workdirOpen, setWorkdirOpen] = useState(false);
  const [workdirDraft, setWorkdirDraft] = useState('');
  const [workdirPosition, setWorkdirPosition] = useState<CSSProperties>();
  const { discoveryGroups = [], leadingAccessories, footerLeadingAccessory, footerAccessories, plusMenuItems } = slots ?? {};
  const hasDiscoveryItems = discoveryGroups.some((group) => group.items.length > 0);
  const slash = slashPalette({ draft: composer.draft, groups: discoveryGroups, dismissedSlashDraft });
  const slashOpen = slash.open;
  const slashActiveOption = Math.min(slashActiveIndex, slash.matches.length - 1);
  const popovers: OpenPopovers = { discoveryMenuOpen, slashOpen, workdirOpen };

  const handleHistoryKey = useComposerHistoryKeys({ composer, textareaRef }, {
    popupOpen: anyPopoverOpen(popovers) || composer.mention.open,
  });

  function restoreComposerFocus() {
    textareaRef.current?.focus();
  }

  /**
   * Neither popover had any way to dismiss on an outside click — Escape worked (each already wires
   * its own keydown), but clicking away left them open with no affordance to close (bug report:
   * "no click-outside, owner is stuck once it opens"). `mousedown`, not `click`, so this settles
   * before the "+" trigger button's own `onToggle` fires on the SAME click — that click's target is
   * inside `.jini-composer-discovery` (the trigger lives there too), so it's correctly treated as
   * "inside" and left for `onToggle` to handle, not fought over by two competing handlers.
   *
   * Scoped by DOM lookup (`closest`/`querySelector`) off `textareaRef`, not new refs threaded
   * through `ComposerDiscovery.tsx`'s props — both popovers already carry stable classes/ids this
   * component doesn't otherwise need direct handles to.
   */
  useEffect(() => {
    if (!anyPopoverOpen(popovers)) return undefined;
    const textarea = textareaRef.current;
    const composerRoot = textarea?.closest('.jini-composer');
    if (!textarea || !composerRoot) return undefined;
    const input = textarea;
    const root = composerRoot;

    function handleOutsideMouseDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (discoveryMenuOpen && isOutside({ root, selector: '.jini-composer-discovery', target })) setDiscoveryMenuOpen(false);
      if (slashOpen && !input.contains(target) && isOutside({ root, selector: '#jini-composer-slash-menu', target })) setDismissedSlashDraft(composer.draft);
      if (workdirOpen && isOutside({ root, selector: '.jini-composer-workdir', target })) setWorkdirOpen(false);
    }

    document.addEventListener('mousedown', handleOutsideMouseDown);
    return () => document.removeEventListener('mousedown', handleOutsideMouseDown);
  }, [discoveryMenuOpen, slashOpen, workdirOpen, composer.draft]);

  /**
   * Anchors the "+" menu and slash palette to `.jini-composer`'s live on-screen rect via
   * `position: fixed` (see `composerDiscoveryMenuPosition`/`composerSlashMenuPosition`'s own doc
   * in `composer-discovery.ts` for the ancestor-clipping bug this fixes). `useLayoutEffect`, not
   * `useEffect`, so the measured position lands before the browser paints the just-opened popover
   * — otherwise the very first frame would flash at the CSS default (`position: absolute`)
   * position before snapping to the fixed one. Recomputed on scroll/resize while either popover is
   * open, matching `useAgentRuntimePicker.hooks.ts`'s identical popover-tracking idiom: the
   * composer's on-screen position can change under an open popover without it ever unmounting.
   */
  useLayoutEffect(() => {
    if (!anyPopoverOpen(popovers)) return undefined;
    const composerRoot = textareaRef.current?.closest('.jini-composer');
    if (!composerRoot) return undefined;
    const root = composerRoot;

    function update() {
      const rect = root.getBoundingClientRect();
      if (discoveryMenuOpen) setDiscoveryMenuPosition(composerDiscoveryMenuPosition({ composerRect: rect }));
      if (slashOpen) setSlashMenuPosition(composerSlashMenuPosition({ composerRect: rect }));
      // Shares the discovery menu's own anchor math (same left inset off `.jini-composer`) rather
      // than measuring the working-dir button's own rect — one less measurement to keep in sync,
      // and the two popovers already never open at once (each is gated on its own trigger).
      if (workdirOpen) setWorkdirPosition(composerDiscoveryMenuPosition({ composerRect: rect }));
    }

    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [discoveryMenuOpen, slashOpen, workdirOpen]);

  /**
   * `expectedDraft` is the draft as the user last saw it at the moment of selection — what the
   * host's effect was computed against. `argument` is passed only for a resolved `'invoke'` on a
   * `command`-bearing item (see `resolveComposerSlashInvocation`); omitted entirely for a plain
   * macro item, matching `ComposerDiscoverySelection.argument`'s own "absent means no command
   * grammar" contract.
   *
   * A `ComposerDiscoveryOutcome` the host returns replaces the draft — this is how a command whose
   * effect is computed asynchronously (e.g. composing agent-directed instruction text) gets to
   * write its result back, since nothing here can guess it in advance the way a plain item's own
   * `insertText` can. But nothing disables the textarea while that effect is in flight, so the
   * live draft (`draftRef.current`) may have moved on by the time it resolves. The outcome is
   * applied only if the live draft still matches `expectedDraft` exactly; otherwise it is
   * DISCARDED — silently overwriting keystrokes the user typed in the meantime would be worse than
   * dropping a result they can reselect.
   */
  function notifyDiscovery(
    item: ComposerDiscoveryItem,
    source: 'plus' | 'slash',
    expectedDraft: string,
    argument?: string | null,
  ) {
    const onDiscoverySelect = slots?.onDiscoverySelect;
    if (!onDiscoverySelect || discoveryEffectInFlightRef.current) return;
    discoveryEffectInFlightRef.current = true;
    runComposerHostEffect({
      effectName: 'onDiscoverySelect',
      effect: () => onDiscoverySelect({ item, source, ...(argument !== undefined ? { argument } : {}) }),
    }, {
      onSettled: () => {
        discoveryEffectInFlightRef.current = false;
      },
      onResolved: (outcome) => {
        if (!outcome || typeof outcome !== 'object') return;
        const draft = (outcome as ComposerDiscoveryOutcome).draft;
        if (draft === undefined) return;
        if (draftRef.current !== expectedDraft) return;
        composer.setDraft(draft);
      },
    });
  }

  function selectSlashItem(item: ComposerDiscoveryItem) {
    const resolution = resolveComposerSlashInvocation({ draft: composer.draft, item });
    if (!resolution) return;

    if (resolution.type === 'complete') {
      // The command word is ambiguous or its argument is still missing — finish the trigger and
      // keep the palette open for further typing. No host effect fires: nothing was invoked yet.
      composer.setDraft(resolution.draft);
      setDismissedSlashDraft(null);
      restoreComposerFocus();
      return;
    }

    let expectedDraft = composer.draft;
    if (!item.command) {
      expectedDraft = replaceComposerSlashTrigger({ draft: composer.draft, insertText: item.insertText ?? item.label });
      composer.setDraft(expectedDraft);
    }
    setDismissedSlashDraft(null);
    notifyDiscovery(item, 'slash', expectedDraft, resolution.argument);
    restoreComposerFocus();
  }

  function selectPlusItem(item: ComposerDiscoveryItem) {
    const expectedDraft = item.insertText ? appendComposerDiscovery({ draft: composer.draft, insertText: item.insertText }) : composer.draft;
    if (item.insertText) composer.setDraft(expectedDraft);
    setDiscoveryMenuOpen(false);
    notifyDiscovery(item, 'plus', expectedDraft);
    restoreComposerFocus();
  }

  /** Opens the working-directory popover, seeding its draft from the live value so a reopen never
   *  shows a stale edit from a previously-dismissed attempt. */
  function toggleWorkdir() {
    if (!workdirOpen) setWorkdirDraft(workingDirectory ?? '');
    setWorkdirOpen((open) => !open);
  }

  /** Confirms the popover's draft. Blank input is treated as "no change" (closes without calling
   *  the host) rather than clearing the directory — this lightweight control has no clear
   *  affordance of its own; `onChangeWorkingDirectory`'s own doc points to the native picker
   *  (`ChatPaneWorkingDirectoryAccess`) that does support clearing. */
  function confirmWorkdir() {
    const trimmed = workdirDraft.trim();
    if (trimmed) onChangeWorkingDirectory?.(trimmed);
    setWorkdirOpen(false);
  }

  /** Palette navigation wins over history and Enter while the slash palette is open; true when it consumed the key. */
  function handleSlashKey(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!slashOpen) return false;
    const action = resolveComposerSlashKeyAction({ key: event.key, shiftKey: event.shiftKey });
    if (action.type === 'none') return false;
    event.preventDefault();
    if (action.type === 'move') {
      setSlashActiveIndex((current) => (current + action.offset + slash.matches.length) % slash.matches.length);
    } else if (action.type === 'select') {
      selectSlashItem(slash.matches[slashActiveOption]!.item);
    } else {
      setDismissedSlashDraft(composer.draft);
    }
    return true;
  }

  function submitFromEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (disabled || !composer.canSubmit) return;
    // Cmd/Ctrl+Enter uses the host shortcut; ChatPane routes it through the ordinary send guards.
    // `sendDisabled` is deliberately NOT consulted here: hosts can offer a shortcut while a run
    // itself blocks ordinary sends. ChatPane queues or delivers live without cancelling the run.
    if ((event.metaKey || event.ctrlKey) && onInterrupt) {
      onInterrupt();
      return;
    }
    if (!sendDisabled) onSend();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (handleSlashKey(event)) return;
    if (handleHistoryKey(event)) return;
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    submitFromEnter(event);
  }

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length > 0 && attachmentPicker) {
      runComposerHostEffect({ effectName: 'attachmentPicker.onFiles', effect: () => attachmentPicker.onFiles(files) });
    }
  }

  /**
   * A screenshot or a Finder-copied video pasted into the textarea previously vanished with no
   * feedback: the browser's default paste has nothing to do with a `File` on the clipboard (it only
   * inserts `text/plain`, which a file-only clipboard entry never carries), so the keystroke was a
   * silent no-op — no chip, no `/api/attachments` call, nothing. This is the paste-side counterpart
   * to `handleAttachmentChange` (the file-input path) and `useChatPaneFileDrop` (the drag-and-drop
   * path); all three now reach `attachmentPicker.onFiles` the same way.
   *
   * `preventDefault` only when `files.length > 0` — an ordinary text paste (the overwhelmingly
   * common case) is left to the browser's own default handling untouched.
   */
  function handleAttachmentPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (!attachmentPicker) return;
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    runComposerHostEffect({ effectName: 'attachmentPicker.onFiles', effect: () => attachmentPicker.onFiles(files) });
  }

  return { attachmentInputRef, textareaRef, discoveryMenuOpen, setDiscoveryMenuOpen, setSlashActiveIndex, setDismissedSlashDraft, discoveryMenuPosition, slashMenuPosition, workdirOpen, setWorkdirOpen, workdirDraft, setWorkdirDraft, workdirPosition, discoveryGroups, leadingAccessories, footerLeadingAccessory, footerAccessories, plusMenuItems, hasDiscoveryItems, slash, slashOpen, slashActiveOption, selectSlashItem, selectPlusItem, toggleWorkdir, confirmWorkdir, handleKeyDown, handleAttachmentChange, handleAttachmentPaste };
}

interface OpenPopovers {
  discoveryMenuOpen: boolean;
  slashOpen: boolean;
  workdirOpen: boolean;
}

function anyPopoverOpen({ discoveryMenuOpen, slashOpen, workdirOpen }: OpenPopovers): boolean {
  return discoveryMenuOpen || slashOpen || workdirOpen;
}

/** A missing popover element counts as outside, so a stale open flag still closes. */
function isOutside({ root, selector, target }: { root: Element; selector: string; target: Node }, _options = {}): boolean {
  return !root.querySelector(selector)?.contains(target);
}

/** Slash palette state derived from the live draft. */
function slashPalette({ draft, groups, dismissedSlashDraft }: { draft: string; groups: readonly ComposerDiscoveryGroup[]; dismissedSlashDraft: string | null }) {
  const query = parseComposerSlashQuery({ draft });
  const matches = query === null ? [] : filterComposerDiscovery({ groups, query });
  return {
    matches,
    open: matches.length > 0 && dismissedSlashDraft !== draft,
    /**
     * A bare "/" intentionally matches every item (`matchesFuzzyCommand`'s own doc) so the palette
     * doubles as a browse-everything view — but with nothing typed yet, nothing on screen tells a
     * first-time user that continuing to type narrows it, and a fuzzy substring match against full
     * descriptions stays broad for the first character or two regardless (owner-reported "it doesn't
     * narrow" — narrowing DOES fire on every keystroke, this is the one state where there's no visual
     * cue that it will). Shown only here, not once the user has started typing a real query — at that
     * point the shrinking list is its own feedback.
     */
    showFilterHint: query !== null && query.command === '' && query.argument === null,
  };
}
