import { useT } from '../../../i18n/index.js';
import { usePresentMenu } from './PresentMenu.hooks.js';

export interface PresentMenuProps {
  disabled?: boolean;
  /** Present inline in the current view (closing the menu is the only behavior this component owns for that action — the host decides what "inline" means for its own layout). */
  onPresentInline(): void;
  onPresentFullscreen(): void;
  onPresentInNewTab(): void;
}

/** The three present actions (source's `presentInThisTab`/`presentFullscreen`/`presentNewTab`), as a disclosure menu. Open/close is local UI state, same shape as `ZoomMenu`. */
export function PresentMenu({ disabled, onPresentInline, onPresentFullscreen, onPresentInNewTab }: PresentMenuProps) {
  const t = useT();
  const { open, setOpen, wrapRef, select } = usePresentMenu({});

  return (
    <div className="jini-present-menu" ref={wrapRef}>
      <button
        type="button"
        className="jini-present-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {t('Present')}
      </button>
      {open ? (
        <div className="jini-present-menu-popover" role="menu">
          <button type="button" role="menuitem" onClick={() => select(onPresentInline)}>
            {t('In this tab')}
          </button>
          <button type="button" role="menuitem" onClick={() => select(onPresentFullscreen)}>
            {t('Fullscreen')}
          </button>
          <button type="button" role="menuitem" onClick={() => select(onPresentInNewTab)}>
            {t('New tab')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
