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
import { FolderChips } from './FolderChips.js';
import {
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { RemixIcon, useAgentHandle } from '../kit.js';
import { agentHandleProps, agentHandleSegment } from '@jini-ai/core/agent-handles';
import { useT } from '../hooks/context.js';
import { AttachmentTray } from './AttachmentTray.js';
import type { UseComposerResult } from '../hooks/useComposer.js';
import type { ComposerPlusItem, ComposerSlots } from '../slots.js';
import { ComposerDiscoveryMenu, ComposerSlashMenu } from './ComposerDiscovery.js';
import { runComposerHostEffect, useComposerView } from './Composer.hooks.js';

export interface ComposerProps {
  /** Stable automation base; false suppresses every package-owned control handle. */
  agentHandle?: string | false | undefined;
  composer: UseComposerResult;
  onSend: () => void;
  disabled?: boolean;
  /** Disables submission without disabling draft editing or attachment controls. */
  sendDisabled?: boolean;
  /** Human-readable submission blocker, exposed on the Send button. */
  sendDisabledReason?: string;
  /** ID of the rendered blocker hint used as the Send button's description. */
  sendDisabledReasonId?: string;
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
   * Once the draft is submittable (and neither gate refuses it), Send comes back beside Stop, so a
   * message can go out mid-run without stopping anything.
   */
  running?: boolean;
  /** Cancels the in-flight run. Required when `running` is true; ignored otherwise. */
  onCancel?: () => void;
  /**
   * Cmd/Ctrl+Enter: optional host send shortcut. ChatPane shares the ordinary mid-run delivery
   * path so sending keeps the current run going. Without this callback the modifier falls
   * through to ordinary Enter, so a host that has not opted in keeps its previous behavior.
   */
  onInterrupt?: () => void;
  /**
   * Current working directory, or null/undefined when none is set yet. Paired with
   * `onChangeWorkingDirectory` — see that prop's own doc for why the trigger's presence is gated
   * on the handler rather than on this value.
   */
  workingDirectory?: string | null;
  /**
   * Confirms a directory typed into the working-directory popover. Its presence (not
   * `workingDirectory`'s) is what renders the folder-icon trigger in "popover" mode, next to the
   * attach/discovery button — for a host with no native picker to offer instead. A host that has
   * `ChatPaneWorkingDirectoryAccess` and wants the SAME trigger wired to the native dialog instead
   * passes `onPickWorkingDirectory` (below) in place of this prop, never both. A host relying on
   * `ChatPane`'s richer below-composer `WorkingDirPicker` passes neither, so it gets no second,
   * competing control here. This is the same working-directory value
   * `ChatPane`/`useChatPaneWorkingDirectory` already own — threaded one level deeper into this
   * presentational component, not a parallel concept.
   */
  onChangeWorkingDirectory?: (workingDirectory: string) => void;
  /**
   * Triggers the host's native OS directory dialog directly. Supplied instead of
   * `onChangeWorkingDirectory` (never alongside it) when the host has a
   * `ChatPaneWorkingDirectoryAccess` implementation and asked `ChatPane` to place the
   * working-directory control in the composer rather than below it
   * (`workingDirectoryControlPlacement="composer"`). Renders the exact same folder-icon trigger as
   * the popover mode — byte-identical `jini-composer-attach` styling, hit area, hover, and focus —
   * but clicking it calls this directly instead of opening the in-page text-input popover: there is
   * nothing to type, the native dialog IS the picker.
   */
  onPickWorkingDirectory?: () => void;
}

/**
 * Renders the controlled message composer and optional attachment picker.
 *
 * @complexity Time/space: O(n) in rendered attachments and supplied menu items.
 * @overallScore 100/100
 */
export function Composer({
  agentHandle,
  composer,
  onSend,
  disabled = false,
  sendDisabled = false,
  sendDisabledReason,
  sendDisabledReasonId,
  placeholder,
  slots,
  attachmentPicker,
  running = false,
  onCancel,
  onInterrupt,
  workingDirectory,
  onChangeWorkingDirectory,
  onPickWorkingDirectory,
}: ComposerProps) {
  const base = useAgentHandle({ agentHandle });
  const t = useT();
  const { attachmentInputRef, textareaRef, discoveryMenuOpen, setDiscoveryMenuOpen, setSlashActiveIndex, setDismissedSlashDraft, discoveryMenuPosition, slashMenuPosition, workdirOpen, setWorkdirOpen, workdirDraft, setWorkdirDraft, workdirPosition, discoveryGroups, leadingAccessories, footerLeadingAccessory, footerAccessories, plusMenuItems, hasDiscoveryItems, slash, slashOpen, slashActiveOption, selectSlashItem, selectPlusItem, toggleWorkdir, confirmWorkdir, handleKeyDown, handleAttachmentChange, handleAttachmentPaste } = useComposerView({ composer, slots, attachmentPicker, workingDirectory, onChangeWorkingDirectory, disabled, sendDisabled, onInterrupt, onSend });

  return (
    <div className="jini-composer">
      <AccessorySlot className="jini-composer-leading">{leadingAccessories}</AccessorySlot>
      <ComposerAttachmentRow base={base} composer={composer} attachmentPicker={attachmentPicker} />
      <textarea
        {...agentHandleProps({}, { base, action: 'draft', role: 'field', label: t('Message draft') })}
        ref={textareaRef}
        className="jini-composer-input"
        value={composer.draft}
        placeholder={placeholder ?? t('Send a message…')}
        disabled={disabled}
        onChange={(e) => {
          composer.setDraft(e.target.value);
          setSlashActiveIndex(0);
          setDismissedSlashDraft(null);
        }}
        onKeyDown={handleKeyDown}
        // Draft persistence is debounced (see `DRAFT_PERSIST_DEBOUNCE_MS`); leaving the field is a
        // natural point to make it durable now.
        onBlur={() => composer.flushDraft?.()}
        onPaste={handleAttachmentPaste}
        {...slashTextareaAria(slashOpen, slashActiveOption)}
        rows={3}
      />
      {slashOpen ? (
        <ComposerSlashMenu
          base={base}
          matches={slash.matches}
          activeIndex={slashActiveOption}
          onSelect={selectSlashItem}
          showFilterHint={slash.showFilterHint}
          style={slashMenuPosition}
          t={t}
        />
      ) : null}
      <div className="jini-composer-footer">
        <ComposerAttachButton base={base} attachmentPicker={attachmentPicker} hidden={hasDiscoveryItems} disabled={disabled} inputRef={attachmentInputRef} onChange={handleAttachmentChange} t={t} />
        <ComposerDiscoveryMenu
          base={base}
          groups={discoveryGroups}
          open={discoveryMenuOpen}
          disabled={disabled}
          {...(attachmentPicker ? { attachmentPicker } : {})}
          attachmentInputRef={attachmentInputRef}
          onToggle={() => setDiscoveryMenuOpen((open) => !open)}
          onClose={() => setDiscoveryMenuOpen(false)}
          onSelect={selectPlusItem}
          onAttachmentChange={handleAttachmentChange}
          style={discoveryMenuPosition}
          t={t}
        />
        <AccessorySlot className="jini-composer-footer-leading">{footerLeadingAccessory}</AccessorySlot>
        <ComposerWorkdirControl
          base={base}
          workingDirectory={workingDirectory}
          onChangeWorkingDirectory={onChangeWorkingDirectory}
          onPickWorkingDirectory={onPickWorkingDirectory}
          disabled={disabled}
          open={workdirOpen}
          draft={workdirDraft}
          position={workdirPosition}
          onToggle={toggleWorkdir}
          onDraftChange={setWorkdirDraft}
          onConfirm={confirmWorkdir}
          onClose={() => setWorkdirOpen(false)}
          t={t}
        />
        {/* One group, so a footer too narrow for everything wraps the picker and send to their own
            line together instead of leaving send alone on it (see the styles' footer rules). */}
        <div className="jini-composer-footer-trailing">
          <AccessorySlot className="jini-composer-footer-accessories">{footerAccessories}</AccessorySlot>
          <ComposerPlusMenu base={base} items={plusMenuItems} t={t} />
          <ComposerSendGroup
            base={base}
            running={running}
            disabled={disabled}
            sendDisabled={sendDisabled}
            canSubmit={composer.canSubmit}
            onSend={onSend}
            onCancel={onCancel}
            sendDisabledReason={sendDisabledReason}
            sendDisabledReasonId={sendDisabledReasonId}
            t={t}
          />
        </div>
      </div>
    </div>
  );
}

type Translate = ReturnType<typeof useT>;

function slashTextareaAria(slashOpen: boolean, activeOption: number) {
  if (!slashOpen) return { 'aria-controls': undefined, 'aria-expanded': false, 'aria-activedescendant': undefined };
  return { 'aria-controls': 'jini-composer-slash-menu', 'aria-expanded': true, 'aria-activedescendant': `jini-composer-slash-option-${activeOption}` };
}

function AccessorySlot({ className, children }: { className: string; children: ReactNode }) {
  return children ? <div className={className}>{children}</div> : null;
}

/** The attached files and folders waiting to go with the next message. */
function ComposerAttachmentRow({ base, composer, attachmentPicker }: {
  base: string | undefined;
  composer: ComposerProps['composer'];
  attachmentPicker: ComposerProps['attachmentPicker'];
}) {
  return (
    <div className="jini-composer-attachments">
      <AttachmentTray agentHandle={base} attachments={composer.attachments} onRemove={composer.removeAttachment} uploading={attachmentPicker?.uploading === true} />
      <FolderChips agentHandle={base} folders={composer.folders} onRemove={composer.removeFolder} />
    </div>
  );
}

/** The plain paperclip, shown only when there is no "+" discovery menu to carry attaching instead. */
function ComposerAttachButton({ base, attachmentPicker, hidden, disabled, inputRef, onChange, t }: {
  base: string | undefined;
  attachmentPicker: ComposerProps['attachmentPicker'];
  hidden: boolean;
  disabled: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  t: Translate;
}) {
  if (!attachmentPicker || hidden) return null;
  const uploading = attachmentPicker.uploading;
  const label = t(uploading ? 'Attaching files…' : 'Attach files');
  return (
    <div className="jini-composer-attachment-picker">
      <input
        ref={inputRef}
        className="jini-composer-file-input"
        data-testid="composer-attachment-input"
        type="file"
        multiple
        aria-label={t('Attach files')}
        accept={attachmentPicker.accept}
        disabled={disabled || uploading}
        onChange={onChange}
      />
      <button
        type="button"
        {...agentHandleProps({}, { base, action: 'attach', role: 'button', label })}
        className="jini-composer-attach"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
        title={label}
        aria-label={label}
      >
        <RemixIcon
          name={uploading ? 'refresh-line' : 'add-line'}
          size={20}
          {...(uploading ? { className: 'jini-composer-spinner' } : {})}
        />
      </button>
    </div>
  );
}

function ComposerWorkdirControl({ base, workingDirectory, onChangeWorkingDirectory, onPickWorkingDirectory, disabled, open, draft, position, onToggle, onDraftChange, onConfirm, onClose, t }: {
  base: string | undefined;
  workingDirectory: string | null | undefined;
  onChangeWorkingDirectory: ComposerProps['onChangeWorkingDirectory'];
  onPickWorkingDirectory: ComposerProps['onPickWorkingDirectory'];
  disabled: boolean;
  open: boolean;
  draft: string;
  position: CSSProperties | undefined;
  onToggle: () => void;
  onDraftChange: (draft: string) => void;
  onConfirm: () => void;
  onClose: () => void;
  t: Translate;
}) {
  if (!onChangeWorkingDirectory && !onPickWorkingDirectory) return null;
  return (
    <div className="jini-composer-workdir" data-testid="composer-workdir">
      <button
        type="button"
        className="jini-composer-attach"
        {...agentHandleProps({}, { base, action: 'workdir', role: 'button', label: t('Set working directory') })}
        data-testid="composer-workdir-trigger"
        disabled={disabled}
        onClick={onPickWorkingDirectory ? () => onPickWorkingDirectory() : onToggle}
        {...(onPickWorkingDirectory ? {} : { 'aria-haspopup': 'dialog' as const, 'aria-expanded': open })}
        title={workingDirectory ?? t('Set working directory')}
        aria-label={
          workingDirectory
            ? t('Working directory: {dir}', { dir: workingDirectory })
            : t('Set working directory')
        }
      >
        <RemixIcon name="folder-line" size={20} />
      </button>
      {!onPickWorkingDirectory && open ? (
        <div
          className="jini-composer-workdir-panel"
          data-testid="composer-workdir-panel"
          role="dialog"
          aria-label={t('Working directory')}
          style={position}
        >
          <input
            type="text"
            className="jini-composer-workdir-input"
            {...agentHandleProps({}, { base, action: 'workdir-path', role: 'field', label: t('Working directory path') })}
            data-testid="composer-workdir-input"
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onConfirm();
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder={t('Working directory path')}
            aria-label={t('Working directory path')}
            autoFocus
          />
          <button
            type="button"
            className="jini-composer-workdir-confirm"
            {...agentHandleProps({}, { base, action: 'workdir-set', role: 'button', label: t('Set working directory') })}
            data-testid="composer-workdir-confirm"
            onClick={onConfirm}
          >
            {t('Set')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ComposerPlusMenu({ base, items, t }: { base: string | undefined; items: readonly ComposerPlusItem[] | undefined; t: Translate }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="jini-composer-plus-menu">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          {...agentHandleProps({}, { base, action: `extra-${agentHandleSegment({ value: item.id })}`, role: 'button', label: t(item.label) })}
          className="jini-composer-plus-item"
          onClick={() => runComposerHostEffect({ effectName: 'plusMenuItems.onSelect', effect: () => item.onSelect() })}
          title={t(item.label)}
        >
          {item.icon ?? null}
          <span>{t(item.label)}</span>
        </button>
      ))}
    </div>
  );
}

function ComposerSendGroup({ base, running, disabled, sendDisabled, canSubmit, onSend, onCancel, sendDisabledReason, sendDisabledReasonId, t }: {
  base: string | undefined;
  running: boolean;
  disabled: boolean;
  sendDisabled: boolean;
  canSubmit: boolean;
  onSend: () => void;
  onCancel: (() => void) | undefined;
  sendDisabledReason: string | undefined;
  sendDisabledReasonId: string | undefined;
  t: Translate;
}) {
  const canSend = !disabled && !sendDisabled && canSubmit;
  return (
    // While a run streams, Send sits beside Stop once there is something to send: a message
    // sent mid-run goes to the running agent (or next, if it cannot take it now). One group so
    // the footer's space-between keeps the two together at the trailing edge.
    <span className="jini-composer-send-group">
      {!running || canSend ? (
        <button {...agentHandleProps({}, { base, action: 'send', role: 'button', label: t('Send') })} type="button" className="jini-composer-send" disabled={!canSend} onClick={onSend} title={sendDisabledReason ?? t('Send')} aria-label={t('Send')} aria-describedby={sendDisabledReasonId}>
          <RemixIcon name="send-plane-2-line" size={16} />
        </button>
      ) : null}
      {running ? (
        <button {...agentHandleProps({}, { base, action: 'stop', role: 'button', label: t('Stop run') })} type="button" className="jini-composer-send jini-composer-send--stop" onClick={onCancel} title={t('Stop run')} aria-label={t('Stop run')}>
          <RemixIcon name="stop-fill" size={14} />
        </button>
      ) : null}
    </span>
  );
}
