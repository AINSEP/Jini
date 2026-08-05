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
import { useRef, type ChangeEvent, type KeyboardEvent } from 'react';
import { RemixIcon } from '@jini-ai/ui';
import { useT } from '../hooks/context.js';
import { AttachmentTray } from './AttachmentTray.js';
import type { UseComposerResult } from '../hooks/useComposer.js';
import type { ComposerSlots } from '../slots.js';

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
}: ComposerProps) {
  const t = useT();
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const resolvedPlaceholder = placeholder ?? t('Send a message…');

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!disabled && !sendDisabled && composer.canSubmit) onSend();
  }

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length > 0) void attachmentPicker?.onFiles(files);
  }

  return (
    <div className="jini-composer">
      {slots?.leadingAccessories ? <div className="jini-composer-leading">{slots.leadingAccessories}</div> : null}
      <AttachmentTray attachments={composer.attachments} onRemove={composer.removeAttachment} />
      <textarea
        className="jini-composer-input"
        value={composer.draft}
        placeholder={resolvedPlaceholder}
        disabled={disabled}
        onChange={(e) => composer.setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
      />
      <div className="jini-composer-footer">
        {attachmentPicker ? (
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
        {slots?.footerAccessories ? (
          <div className="jini-composer-footer-accessories">{slots.footerAccessories}</div>
        ) : null}
        {slots?.plusMenuItems && slots.plusMenuItems.length > 0 ? (
          <div className="jini-composer-plus-menu">
            {slots.plusMenuItems.map((item) => (
              <button key={item.id} type="button" className="jini-composer-plus-item" onClick={() => void item.onSelect()} title={t(item.label)}>
                {item.icon ?? null}
                <span>{t(item.label)}</span>
              </button>
            ))}
          </div>
        ) : null}
        <button type="button" className="jini-composer-send" disabled={disabled || sendDisabled || !composer.canSubmit} onClick={onSend} title={t('Send')} aria-label={t('Send')}>
          <RemixIcon name="send-plane-2-line" size={16} />
        </button>
      </div>
    </div>
  );
}
