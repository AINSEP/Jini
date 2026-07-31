import { useLayoutEffect } from 'react';
import type { CSSProperties } from 'react';
import { useT } from '../../../../../../features/i18n/index.js';
import { Icon } from '../../../../../../react/components/Icon.js';
import {
  ACCENT_SWATCHES,
  DEFAULT_ACCENT_COLOR,
  applyAppearanceToDocument,
  normalizeAccentColor,
  resolveAccentColor,
} from '../../../../../../utils/appearance.js';
import { THEME_OPTIONS } from '@jini-ai/ui-core';
import type { SettingsThemeChoice } from '@jini-ai/ui-core';

export interface AppearanceTabProps {
  theme: SettingsThemeChoice;
  onThemeChange: (theme: SettingsThemeChoice) => void;
  /** Candidate `#rrggbb` accent color; invalid/missing falls back to
   *  `DEFAULT_ACCENT_COLOR` for display (the raw value is not mutated). */
  accentColor?: string;
  onAccentColorChange: (accentColor: string) => void;
  /** Swatch palette. Defaults to this package's neutral 8-color set. */
  accentSwatches?: readonly string[];
  /** Live-previews the picked theme/accent onto `document.documentElement`
   *  via `applyAppearanceToDocument` as the user picks (before any "Save").
   *  Defaults to `true`, matching the origin's live-preview behavior; a host
   *  that applies appearance elsewhere (e.g. its own persisted-config
   *  effect) can turn this off to avoid a double-write. */
  livePreview?: boolean;
  ariaLabel?: string;
  accentLabel?: string;
  defaultAccentAriaLabel?: string;
  customAccentAriaLabel?: string;
}

/**
 * Theme (system/light/dark) segmented control + accent-color swatch grid
 * with a custom color picker. Origin: `AppearanceSection` in
 * `SettingsDialog.tsx` — GENERIC, no product coupling beyond the (already
 * dropped) analytics tracking calls.
 */
export function AppearanceTab({
  theme,
  onThemeChange,
  accentColor,
  onAccentColorChange,
  accentSwatches = ACCENT_SWATCHES,
  livePreview = true,
  ariaLabel,
  accentLabel,
  defaultAccentAriaLabel,
  customAccentAriaLabel,
}: AppearanceTabProps) {
  const t = useT();
  const resolvedAccent = resolveAccentColor(accentColor);
  const resolvedAriaLabel = ariaLabel ?? t('Appearance');
  const resolvedAccentLabel = accentLabel ?? t('Accent color');
  const resolvedDefaultAccentAriaLabel = defaultAccentAriaLabel ?? t('Default accent color');
  const resolvedCustomAccentAriaLabel = customAccentAriaLabel ?? t('Custom accent color');

  const appliedTheme = theme === 'system' ? undefined : theme;
  useLayoutEffect(() => {
    if (!livePreview) return;
    applyAppearanceToDocument({ ...(appliedTheme ? { theme: appliedTheme } : {}), accentColor: resolvedAccent });
  }, [livePreview, appliedTheme, resolvedAccent]);

  return (
    <section className="jini-settings-section jini-settings-appearance">
      <div
        className="jini-seg-control"
        role="group"
        aria-label={resolvedAriaLabel}
        style={{ '--seg-cols': THEME_OPTIONS.length } as CSSProperties}
      >
        {THEME_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={'jini-seg-btn' + (theme === option.value ? ' active' : '')}
            aria-pressed={theme === option.value}
            onClick={() => onThemeChange(option.value)}
          >
            {option.icon ? <Icon name={option.icon} size={14} aria-hidden="true" /> : null}
            <span className="jini-seg-title">{t(option.label)}</span>
          </button>
        ))}
      </div>

      <div className="jini-field">
        <span className="jini-field-label">{resolvedAccentLabel}</span>
        <div className="jini-accent-swatches" role="radiogroup" aria-label={resolvedAccentLabel}>
          {accentSwatches.map((color) => {
            const active = resolvedAccent === color;
            return (
              <button
                key={color}
                type="button"
                className={`jini-accent-swatch${active ? ' active' : ''}`}
                style={{ background: color }}
                aria-label={color === DEFAULT_ACCENT_COLOR ? resolvedDefaultAccentAriaLabel : color}
                aria-checked={active}
                role="radio"
                onClick={() => onAccentColorChange(normalizeAccentColor(color) ?? color)}
              />
            );
          })}
          <input
            type="color"
            aria-label={resolvedCustomAccentAriaLabel}
            className="jini-accent-swatch-picker"
            value={resolvedAccent}
            onChange={(event) => onAccentColorChange(event.target.value)}
          />
        </div>
      </div>
    </section>
  );
}
