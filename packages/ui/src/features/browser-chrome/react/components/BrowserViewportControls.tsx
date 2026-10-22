import { useRef, useState } from 'react';
import type { BrowserViewportId, BrowserViewportPreset } from '../../types.js';
import { BROWSER_VIEWPORT_PRESETS } from '../../constants.js';
import { useT } from '../../../i18n/index.js';
import { Icon } from '../../../../react/components/Icon.js';
import { RemixIcon } from '../../../../react/components/RemixIcon.js';
import { useDismissOnOutsideOrEscape } from '../../../../browser/index.js';

function viewportIconName(viewport: BrowserViewportId): string {
  if (viewport === 'tablet') return 'tablet-line';
  if (viewport === 'mobile') return 'smartphone-line';
  return 'computer-line';
}

export interface BrowserViewportControlsProps {
  viewport: BrowserViewportId;
  onViewport: (viewport: BrowserViewportId) => void;
  disabled?: boolean;
  /** Override the built-in desktop/tablet/mobile preset list. */
  presets?: BrowserViewportPreset[];
}

/**
 * Responsive viewport-preset switcher: a dropdown trigger showing the active
 * preset, expanding into a listbox of presets on click. Closes on an
 * outside pointerdown or Escape via the shared `useDismissOnOutsideOrEscape`
 * hook (`packages/ui/src/browser/`) rather than a hand-rolled listener pair.
 *
 * Confirmed (2026-07-17) to be the same shape as `FileViewer.tsx`'s
 * `PreviewViewportControls` — see `packages/ui/source-map.md`'s
 * `features/browser-chrome/` section before building a second one.
 */
export function BrowserViewportControls({
  viewport,
  onViewport,
  disabled,
  presets = BROWSER_VIEWPORT_PRESETS,
}: BrowserViewportControlsProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const activePreset = presets.find((preset) => preset.id === viewport) ?? presets[0];

  useDismissOnOutsideOrEscape({ onDismiss: () => setOpen(false) }, { enabled: open, containerRef: menuRef });

  if (!activePreset) return null;

  return (
    <div className="jini-browser-viewport-switcher" ref={menuRef}>
      <span
        className="jini-tooltip jini-browser-viewport-tooltip-anchor"
        data-tooltip={t(activePreset.title)}
        data-tooltip-placement="bottom"
      >
        <button
          type="button"
          className={`jini-browser-viewport-trigger${open ? ' is-active' : ''}`}
          aria-label={t(activePreset.title)}
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={disabled ?? false}
          onClick={() => setOpen((value) => !value)}
        >
          <RemixIcon name={viewportIconName(activePreset.id)} size={14} className="jini-browser-viewport-icon" />
          <span className="jini-browser-viewport-label">{t(activePreset.label)}</span>
          <RemixIcon name="arrow-down-s-line" size={13} />
        </button>
      </span>
      {open ? (
        <div className="jini-browser-viewport-menu" role="listbox" aria-label={t('Viewport')}>
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              role="option"
              aria-selected={preset.id === viewport}
              className={preset.id === viewport ? 'active' : ''}
              onClick={() => {
                onViewport(preset.id);
                setOpen(false);
              }}
            >
              <span className="jini-browser-viewport-menu-label">
                <RemixIcon name={viewportIconName(preset.id)} size={14} />
                <span>{t(preset.label)}</span>
              </span>
              {preset.id === viewport ? <Icon name="check" size={13} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
