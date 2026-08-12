import type { ChangeEvent, RefObject } from 'react';
import { RemixIcon } from '@jini-ai/ui';
import type { ComposerDiscoveryGroup, ComposerDiscoveryItem } from '../slots.js';
import type { ComposerDiscoveryMatch } from './composer-discovery.js';

interface AttachmentPicker {
  onFiles: (files: File[]) => void | Promise<void>;
  accept?: string;
  uploading?: boolean;
}

export interface ComposerDiscoveryMenuProps {
  groups: readonly ComposerDiscoveryGroup[];
  open: boolean;
  disabled: boolean;
  attachmentPicker?: AttachmentPicker;
  attachmentInputRef: RefObject<HTMLInputElement | null>;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (item: ComposerDiscoveryItem) => void;
  onAttachmentChange: (event: ChangeEvent<HTMLInputElement>) => void;
  t: (key: string) => string;
}

/** Generic grouped add-menu; the host owns all inventory labels and items. */
export function ComposerDiscoveryMenu(props: ComposerDiscoveryMenuProps) {
  const hasItems = props.groups.some((group) => group.items.length > 0);
  if (!hasItems) return null;

  return (
    <div
      className="jini-composer-discovery"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !props.open) return;
        event.preventDefault();
        props.onClose();
      }}
    >
      {props.attachmentPicker ? (
        <input
          ref={props.attachmentInputRef}
          className="jini-composer-file-input"
          type="file"
          multiple
          aria-label={props.t('Attach files')}
          accept={props.attachmentPicker.accept}
          disabled={props.disabled || props.attachmentPicker.uploading}
          onChange={props.onAttachmentChange}
        />
      ) : null}
      <button
        type="button"
        className="jini-composer-attach"
        disabled={props.disabled}
        onClick={props.onToggle}
        aria-expanded={props.open}
        aria-haspopup="menu"
        title={props.t('Add context')}
        aria-label={props.t('Add context')}
      >
        <RemixIcon name="add-line" size={20} />
      </button>
      {props.open ? (
        <div className="jini-composer-discovery-menu" role="menu" aria-label={props.t('Add context')}>
          {props.attachmentPicker ? (
            <div className="jini-composer-discovery-group" role="group" aria-label={props.t('Files')}>
              <span className="jini-composer-discovery-group-label">{props.t('Files')}</span>
              <button
                type="button"
                role="menuitem"
                className="jini-composer-discovery-item"
                disabled={props.disabled || props.attachmentPicker.uploading}
                onClick={() => {
                  props.onClose();
                  props.attachmentInputRef.current?.click();
                }}
              >
                {props.t(props.attachmentPicker.uploading ? 'Attaching files…' : 'Attach files')}
              </button>
            </div>
          ) : null}
          {props.groups.map((group) =>
            group.items.length > 0 ? (
              <div key={group.id} className="jini-composer-discovery-group" role="group" aria-label={props.t(group.label)}>
                <span className="jini-composer-discovery-group-label">{props.t(group.label)}</span>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className="jini-composer-discovery-item"
                    onClick={() => props.onSelect(item)}
                  >
                    <span>{props.t(item.label)}</span>
                    {item.description ? <small>{props.t(item.description)}</small> : null}
                  </button>
                ))}
              </div>
            ) : null,
          )}
        </div>
      ) : null}
    </div>
  );
}

export interface ComposerSlashMenuProps {
  matches: readonly ComposerDiscoveryMatch[];
  activeIndex: number;
  onSelect: (item: ComposerDiscoveryItem) => void;
  t: (key: string) => string;
}

/** Keyboard navigation is owned by Composer so focus stays in the textarea. */
export function ComposerSlashMenu(props: ComposerSlashMenuProps) {
  if (props.matches.length === 0) return null;

  return (
    <div
      id="jini-composer-slash-menu"
      className="jini-composer-slash-menu"
      role="listbox"
      aria-label={props.t('Composer commands')}
    >
      {props.matches.map((match, index) => (
        <button
          key={`${match.groupId}:${match.item.id}`}
          id={`jini-composer-slash-option-${index}`}
          type="button"
          role="option"
          aria-selected={index === props.activeIndex}
          className={`jini-composer-discovery-item${index === props.activeIndex ? ' is-active' : ''}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => props.onSelect(match.item)}
        >
          <span>
            {props.t(match.item.label)}
            {match.item.argument ? (
              <code className="jini-composer-slash-argument"> {match.item.argument.placeholder}</code>
            ) : null}
            {match.item.needsConfirmation ? (
              <small className="jini-composer-slash-confirm-badge"> {props.t('Confirm')}</small>
            ) : null}
          </span>
          <small>
            {props.t(match.item.description ?? match.groupLabel)}
          </small>
        </button>
      ))}
    </div>
  );
}
