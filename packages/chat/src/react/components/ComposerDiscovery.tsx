import type { ChangeEvent, CSSProperties, RefObject } from 'react';
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
  /** Viewport-fixed position computed by `Composer.tsx` (see `composerDiscoveryMenuPosition` in
   *  `composer-discovery.ts`) so the popover escapes any `overflow: hidden` ancestor between the
   *  composer and the page root. `undefined` for the one synchronous render before that
   *  measurement lands, during which the reference stylesheet's `position: absolute` default
   *  still applies — inline `style` always wins once it is set. */
  style?: CSSProperties | undefined;
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
          data-testid="composer-attachment-input"
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
        <div className="jini-composer-discovery-menu" style={props.style} role="menu" aria-label={props.t('Add context')}>
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
                {group.items.map((item) => {
                  const description = item.description ? props.t(item.description) : undefined;
                  const descriptionId = description ? `jini-composer-discovery-desc-${item.id}` : undefined;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      className="jini-composer-discovery-item"
                      aria-describedby={descriptionId}
                      onClick={() => props.onSelect(item)}
                    >
                      <span>{props.t(item.label)}</span>
                      {/* Kept compact by design (label only) — the full description is a real
                          hover/focus tooltip (`.jini-composer-discovery-description`, styled to
                          match the popover itself — see its own doc in styles.ts for why NOT a bare
                          `title` attribute), reachable for assistive tech via `aria-describedby`
                          whether or not anything is hovering. */}
                      {description ? (
                        <small id={descriptionId} className="jini-composer-discovery-description">
                          {description}
                        </small>
                      ) : null}
                    </button>
                  );
                })}
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
  /** True only for a bare "/" (see `Composer.tsx`'s own doc on `showSlashFilterHint`) — shows a
   *  one-line "keep typing to narrow" cue above the options, since that's the one state where
   *  nothing else on screen signals that typing filters the list. */
  showFilterHint?: boolean;
  t: (key: string) => string;
  /** Viewport-fixed position computed by `Composer.tsx` (see `composerSlashMenuPosition` in
   *  `composer-discovery.ts`) — same escape-the-ancestor-clip mechanism as
   *  {@link ComposerDiscoveryMenuProps.style}. */
  style?: CSSProperties | undefined;
}

/** Keyboard navigation is owned by Composer so focus stays in the textarea. */
export function ComposerSlashMenu(props: ComposerSlashMenuProps) {
  if (props.matches.length === 0) return null;

  return (
    <div
      id="jini-composer-slash-menu"
      className="jini-composer-slash-menu"
      style={props.style}
      role="listbox"
      aria-label={props.t('Composer commands')}
    >
      {props.showFilterHint ? (
        // `role="presentation"` opts this out of the listbox's own "children are options" ARIA
        // expectation explicitly, rather than leaving an unmarked stray `<div>` for assistive tech
        // to guess about — same escape hatch real combobox implementations use for a "no results"
        // row. Reuses `.jini-composer-discovery-group-label`'s existing look (faint, small,
        // uppercase) instead of introducing a new visual style for one hint line.
        <div className="jini-composer-discovery-group-label" role="presentation">
          {props.t('Keep typing to narrow the list')}
        </div>
      ) : null}
      {props.matches.map((match, index) => {
        const description = props.t(match.item.description ?? match.groupLabel);
        const descriptionId = `jini-composer-slash-option-${index}-desc`;
        return (
          <button
            key={`${match.groupId}:${match.item.id}`}
            id={`jini-composer-slash-option-${index}`}
            type="button"
            role="option"
            aria-selected={index === props.activeIndex}
            aria-describedby={descriptionId}
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
            {/* Compact row, real hover/focus tooltip — see the matching doc on the "+" menu's
                identical change just above. */}
            <small id={descriptionId} className="jini-composer-discovery-description">
              {description}
            </small>
          </button>
        );
      })}
    </div>
  );
}
