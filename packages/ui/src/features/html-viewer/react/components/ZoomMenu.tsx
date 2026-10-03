import { useRef } from 'react';
import { useDismissOnOutsideOrEscape } from '../../../../browser/index.js';
import { useT } from '../../../i18n/index.js';

export interface ZoomMenuProps {
  zoom: number;
  levels: readonly number[];
  isOpen: boolean;
  onToggle(): void;
  onClose(): void;
  onSelect(level: number): void;
}

/** Percentage zoom trigger + preset dropdown, matching the source's zoom-menu shape. Outside-click/Escape dismiss is local to this component (small, self-contained UI behavior — see `features/version-manager/`'s `VersionPromptPopover` for the same pattern). */
export function ZoomMenu({ zoom, levels, isOpen, onToggle, onClose, onSelect }: ZoomMenuProps) {
  const t = useT();
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useDismissOnOutsideOrEscape({ onDismiss: onClose }, { enabled: isOpen, containerRef: wrapRef });

  return (
    <div className="jini-zoom-menu" ref={wrapRef}>
      <button
        type="button"
        className="jini-zoom-trigger"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title={t('Reset zoom')}
        onClick={onToggle}
      >
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{zoom}%</span>
      </button>
      {isOpen ? (
        <div className="jini-zoom-menu-popover" role="menu">
          {levels.map((level) => (
            <button
              key={level}
              type="button"
              className={`jini-zoom-menu-item${zoom === level ? ' active' : ''}`}
              role="menuitem"
              onClick={() => onSelect(level)}
            >
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{level}%</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
