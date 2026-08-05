import { useId, useRef, useState } from 'react';
import { Icon } from '../../../../react/components/Icon.js';
import { RemixIcon } from '../../../../react/components/RemixIcon.js';
import { useDismissOnOutsideOrEscape } from '../../../../browser/useDismissOnOutsideOrEscape.js';
import type { ViewportPreset } from '../../types.js';

export interface ViewportSwitcherProps {
  presets: ViewportPreset[];
  viewport: string;
  onViewport: (viewport: string) => void;
  ariaLabel: string;
  tabIndex?: number;
}

/**
 * Self-contained responsive desktop/tablet/mobile viewport switcher: a
 * trigger button showing the active preset, opening a listbox menu of the
 * rest. Generalizes the source component's `PreviewViewportControls`.
 *
 * A second component in the same source tree (`DesignBrowserPanel.tsx`'s
 * `BrowserViewportControls`, not yet extracted — see
 * `ADS-memory/reports/jini-port/god-components-extraction-plan.md`'s consolidation map)
 * turned out, on a side-by-side read, to be the exact same shape: a trigger
 * button + dropdown listbox over the same preset list, same outside-
 * click/Escape-to-close behavior, differing only in cosmetic wrapper markup
 * (an icon-tooltip-button wrapper vs. a plain button) and a `disabled` prop
 * the other component didn't have. This component is that shared primitive
 * — when that other file's extraction happens, it should bind to this
 * component rather than re-implement its own dropdown switcher. See
 * `packages/ui/source-map.md` for the full comparison.
 */
export function ViewportSwitcher({ presets, viewport, onViewport, ariaLabel, tabIndex }: ViewportSwitcherProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const activePreset = presets.find((preset) => preset.id === viewport) ?? presets[0];

  useDismissOnOutsideOrEscape(() => setOpen(false), { enabled: open, containerRef: menuRef });

  if (!activePreset) return null;
  const activeLabel = activePreset.title ?? activePreset.label;

  return (
    <div className="viewer-viewport-switcher" ref={menuRef}>
      <button
        type="button"
        className="viewer-action viewer-viewport-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        title={activeLabel}
        tabIndex={tabIndex}
        onClick={() => setOpen((v) => !v)}
      >
        {activePreset.icon ? <RemixIcon name={activePreset.icon} size={14} className="viewer-viewport-icon" /> : null}
        <span>{activePreset.label}</span>
      </button>
      {open ? (
        <div className="viewer-viewport-menu" id={listboxId} role="listbox" aria-label={ariaLabel}>
          {presets.map((preset) => {
            const selected = viewport === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                className={`viewer-viewport-menu-item${selected ? ' active' : ''}`}
                role="option"
                aria-selected={selected}
                title={preset.title ?? preset.label}
                onClick={() => {
                  onViewport(preset.id);
                  setOpen(false);
                }}
              >
                <span className="viewer-viewport-menu-label">
                  {preset.icon ? <RemixIcon name={preset.icon} size={14} /> : null}
                  <span>{preset.label}</span>
                </span>
                {selected ? <Icon name="check" size={13} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
