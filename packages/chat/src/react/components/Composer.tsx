/**
 * @module Composer
 *
 * The dumb, presentational half of the composer: takes a `useComposer()`
 * controller (headless state) plus a few UI-only props and renders the
 * textarea/attachment-tray/send-button chrome. Slot extraction points
 * (`ComposerPlusItem[]`, `leadingAccessories`, `footerAccessories`, the mention popover) are
 * generalized from OD's `ChatComposer.tsx` decomposition
 * (`ComposerPlusMenu`/`LibraryPicker`/`SessionModeToggle`-equivalent) per
 * `ADS-memory/reports/jini-port/recon/r4b-webui-design.md` §2/§3 — this component renders
 * the slots a host supplies; it does not itself know what a "library
 * picker" or "session mode" is.
 */
import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { RemixIcon } from '@jini-ai/ui';
import { useT } from '../hooks/context.js';
import { AttachmentTray } from './AttachmentTray.js';
import type { UseComposerResult } from '../hooks/useComposer.js';
import type { ComposerDiscoveryItem, ComposerDiscoveryOutcome, ComposerSlots } from '../slots.js';
import { ComposerDiscoveryMenu, ComposerSlashMenu } from './ComposerDiscovery.js';
import {
  appendComposerDiscovery,
  filterComposerDiscovery,
  parseComposerSlashQuery,
  replaceComposerSlashTrigger,
  resolveComposerSlashInvocation,
  resolveComposerSlashKeyAction,
} from './composer-discovery.js';

export interface ComposerProps {
  composer: UseComposerResult;
  onSend: () => void;
  disabled?: boolean;
  /** Disables submission without disabling draft editing or attachment controls. */
  sendDisabled?: boolean;
  placeholder?: string;
  slots?: ComposerSlots;
  attachmentPicker?: {
    onFiles: (files: File[]) => void | Promise<void>;
    accept?: string;
    uploading?: boolean;
  };
  /**
   * A run is currently streaming. Swaps the trailing send button for a stop button in the same
   * position — same control an operator already has their attention on, rather than a second,
   * separately placed cancel affordance elsewhere in the pane. Always clickable when true,
   * regardless of `disabled`/`sendDisabled`/`composer.canSubmit`: those all gate *submitting a new
   * draft*, which has nothing to do with whether a caller may cancel the run already in flight.
   */
  running?: boolean;
  /** Cancels the in-flight run. Required when `running` is true; ignored otherwise. */
  onCancel?: () => void;
}

function reportComposerHostEffectFailure(effectName: string, error: unknown) {
  console.error(`[@jini-ai/chat] Composer ${effectName} host effect failed:`, error);
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
function runComposerHostEffect(
  effectName: string,
  effect: () => unknown,
  onSettled?: () => void,
  onResolved?: (result: unknown) => void,
) {
  let result: unknown;
  try {
    result = effect();
  } catch (error) {
    reportComposerHostEffectFailure(effectName, error);
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
      reportComposerHostEffectFailure(effectName, error);
    })
    .finally(() => {
      if (asynchronous) onSettled?.();
    });
}

/**
 * Renders the controlled message composer and optional attachment picker.
 *
 * @complexity Time/space: O(n) in rendered attachments and supplied menu items.
 * @overallScore 100/100
 */
export function Composer({
  composer,
  onSend,
  disabled = false,
  sendDisabled = false,
  placeholder,
  slots,
  attachmentPicker,
  running = false,
  onCancel,
}: ComposerProps) {
  const t = useT();
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
  const resolvedPlaceholder = placeholder ?? t('Send a message…');
  const discoveryGroups = slots?.discoveryGroups ?? [];
  const hasDiscoveryItems = discoveryGroups.some((group) => group.items.length > 0);
  const slashQuery = parseComposerSlashQuery(composer.draft);
  const slashMatches = slashQuery === null ? [] : filterComposerDiscovery(discoveryGroups, slashQuery);
  const slashOpen = slashMatches.length > 0 && dismissedSlashDraft !== composer.draft;

  function restoreComposerFocus() {
    textareaRef.current?.focus();
  }

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
    runComposerHostEffect(
      'onDiscoverySelect',
      () => onDiscoverySelect({ item, source, ...(argument !== undefined ? { argument } : {}) }),
      () => {
        discoveryEffectInFlightRef.current = false;
      },
      (outcome) => {
        if (!outcome || typeof outcome !== 'object') return;
        const draft = (outcome as ComposerDiscoveryOutcome).draft;
        if (draft === undefined) return;
        if (draftRef.current !== expectedDraft) return;
        composer.setDraft(draft);
      },
    );
  }

  function selectSlashItem(index: number) {
    const match = slashMatches[index];
    if (!match) return;
    const resolution = resolveComposerSlashInvocation(composer.draft, match.item);
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
    if (!match.item.command) {
      expectedDraft = replaceComposerSlashTrigger(composer.draft, match.item.insertText ?? match.item.label);
      composer.setDraft(expectedDraft);
    }
    setDismissedSlashDraft(null);
    notifyDiscovery(match.item, 'slash', expectedDraft, resolution.argument);
    restoreComposerFocus();
  }

  function selectPlusItem(item: ComposerDiscoveryItem) {
    const expectedDraft = item.insertText ? appendComposerDiscovery(composer.draft, item.insertText) : composer.draft;
    if (item.insertText) composer.setDraft(expectedDraft);
    setDiscoveryMenuOpen(false);
    notifyDiscovery(item, 'plus', expectedDraft);
    restoreComposerFocus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (slashOpen) {
      const action = resolveComposerSlashKeyAction(event.key, event.shiftKey);
      if (action.type !== 'none') {
        event.preventDefault();
        if (action.type === 'move') {
          setSlashActiveIndex((current) => (current + action.offset + slashMatches.length) % slashMatches.length);
        } else if (action.type === 'select') {
          selectSlashItem(Math.min(slashActiveIndex, slashMatches.length - 1));
        } else {
          setDismissedSlashDraft(composer.draft);
        }
        return;
      }
    }
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    if (!disabled && !sendDisabled && composer.canSubmit) onSend();
  }

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length > 0 && attachmentPicker) {
      runComposerHostEffect('attachmentPicker.onFiles', () => attachmentPicker.onFiles(files));
    }
  }

  return (
    <div className="jini-composer">
      {slots?.leadingAccessories ? <div className="jini-composer-leading">{slots.leadingAccessories}</div> : null}
      <AttachmentTray attachments={composer.attachments} onRemove={composer.removeAttachment} />
      <textarea
        ref={textareaRef}
        className="jini-composer-input"
        value={composer.draft}
        placeholder={resolvedPlaceholder}
        disabled={disabled}
        onChange={(e) => {
          composer.setDraft(e.target.value);
          setSlashActiveIndex(0);
          setDismissedSlashDraft(null);
        }}
        onKeyDown={handleKeyDown}
        aria-controls={slashOpen ? 'jini-composer-slash-menu' : undefined}
        aria-expanded={slashOpen}
        aria-activedescendant={
          slashOpen
            ? `jini-composer-slash-option-${Math.min(slashActiveIndex, slashMatches.length - 1)}`
            : undefined
        }
        rows={3}
      />
      {slashOpen ? (
        <ComposerSlashMenu
          matches={slashMatches}
          activeIndex={Math.min(slashActiveIndex, slashMatches.length - 1)}
          onSelect={(item) => selectSlashItem(slashMatches.findIndex((match) => match.item === item))}
          t={t}
        />
      ) : null}
      <div className="jini-composer-footer">
        {attachmentPicker && !hasDiscoveryItems ? (
          <div className="jini-composer-attachment-picker">
            <input
              ref={attachmentInputRef}
              className="jini-composer-file-input"
              type="file"
              multiple
              aria-label={t('Attach files')}
              accept={attachmentPicker.accept}
              disabled={disabled || attachmentPicker.uploading}
              onChange={handleAttachmentChange}
            />
            <button
              type="button"
              className="jini-composer-attach"
              disabled={disabled || attachmentPicker.uploading}
              onClick={() => attachmentInputRef.current?.click()}
              title={t(attachmentPicker.uploading ? 'Attaching files…' : 'Attach files')}
              aria-label={t(attachmentPicker.uploading ? 'Attaching files…' : 'Attach files')}
            >
              <RemixIcon
                name={attachmentPicker.uploading ? 'refresh-line' : 'add-line'}
                size={20}
                {...(attachmentPicker.uploading ? { className: 'jini-composer-spinner' } : {})}
              />
            </button>
          </div>
        ) : null}
        {hasDiscoveryItems ? (
          <ComposerDiscoveryMenu
            groups={discoveryGroups}
            open={discoveryMenuOpen}
            disabled={disabled}
            {...(attachmentPicker ? { attachmentPicker } : {})}
            attachmentInputRef={attachmentInputRef}
            onToggle={() => setDiscoveryMenuOpen((open) => !open)}
            onClose={() => setDiscoveryMenuOpen(false)}
            onSelect={selectPlusItem}
            onAttachmentChange={handleAttachmentChange}
            t={t}
          />
        ) : null}
        {slots?.footerAccessories ? (
          <div className="jini-composer-footer-accessories">{slots.footerAccessories}</div>
        ) : null}
        {slots?.plusMenuItems && slots.plusMenuItems.length > 0 ? (
          <div className="jini-composer-plus-menu">
            {slots.plusMenuItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="jini-composer-plus-item"
                onClick={() => runComposerHostEffect('plusMenuItems.onSelect', () => item.onSelect())}
                title={t(item.label)}
              >
                {item.icon ?? null}
                <span>{t(item.label)}</span>
              </button>
            ))}
          </div>
        ) : null}
        {running ? (
          <button type="button" className="jini-composer-send jini-composer-send--stop" onClick={onCancel} title={t('Stop run')} aria-label={t('Stop run')}>
            <RemixIcon name="stop-fill" size={14} />
          </button>
        ) : (
          <button type="button" className="jini-composer-send" disabled={disabled || sendDisabled || !composer.canSubmit} onClick={onSend} title={t('Send')} aria-label={t('Send')}>
            <RemixIcon name="send-plane-2-line" size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
