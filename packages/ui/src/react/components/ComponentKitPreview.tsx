import type { CSSProperties } from 'react';
import { useT } from '../../features/i18n/index.js';
import { readableTextColor } from '../../utils/color-math.js';
import { TokenChip } from './TokenChip.js';
import { ValueChip } from './ValueChip.js';

export interface ComponentKitPreviewThemeTokens {
  background: string;
  surface: string;
  foreground: string;
  muted: string;
  border: string;
}

export interface ComponentKitPreviewTokens {
  name: string;
  description?: string | undefined;
  displayFont: string;
  bodyFont: string;
  /** Border radius in px. */
  radius: number;
  /** Base font size in px. */
  fontSize: number;
  colorPrimary: string;
  colorPrimaryBg: string;
  colorPrimaryHover: string;
  colorPrimaryActive: string;
  light: ComponentKitPreviewThemeTokens;
  dark: ComponentKitPreviewThemeTokens;
}

export type ComponentKitPreviewThemeMode = 'light' | 'dark';

export interface ComponentKitPreviewProps {
  tokens: ComponentKitPreviewTokens;
  theme: ComponentKitPreviewThemeMode;
  onThemeChange: (theme: ComponentKitPreviewThemeMode) => void;
}

/**
 * A theme-toggle-driven style-guide preview panel: given a token set (colors,
 * type, radius), renders a light/dark-switchable stage with a button
 * showcase, a type-scale sample, and the extracted token chips underneath.
 *
 * Origin: `DesignMdComponentKitPreview` (`DesignSystemFlow.tsx`). The
 * origin took a raw `markdown: string` and parsed it internally
 * (`buildDesignMdPreviewModel` → `parseDesignMd`) into this same token
 * shape; that markdown-parsing pipeline is OD-specific product logic (their
 * "design.md" spec format) and is not ported — same call already made for
 * the color-mixing math this component leans on (`readableTextColor`, see
 * `packages/ui/source-map.md`'s color-math section: "what was deliberately
 * left behind"). This component instead takes the already-resolved token
 * model directly, genericizing the token *source* to whatever the host
 * computes it from.
 */
export function ComponentKitPreview({ tokens, theme, onThemeChange }: ComponentKitPreviewProps) {
  const t = useT();
  const themeTokens = theme === 'dark' ? tokens.dark : tokens.light;
  const style = {
    '--jini-kit-preview-bg': themeTokens.background,
    '--jini-kit-preview-surface': themeTokens.surface,
    '--jini-kit-preview-fg': themeTokens.foreground,
    '--jini-kit-preview-muted': themeTokens.muted,
    '--jini-kit-preview-border': themeTokens.border,
    '--jini-kit-preview-primary': tokens.colorPrimary,
    '--jini-kit-preview-primary-bg': tokens.colorPrimaryBg,
    '--jini-kit-preview-primary-hover': tokens.colorPrimaryHover,
    '--jini-kit-preview-primary-active': tokens.colorPrimaryActive,
    '--jini-kit-preview-radius': `${tokens.radius}px`,
    '--jini-kit-preview-display-font': tokens.displayFont,
    '--jini-kit-preview-body-font': tokens.bodyFont,
    '--jini-kit-preview-font-size': `${tokens.fontSize}px`,
  } as CSSProperties;
  const primaryText = readableTextColor({ hex: tokens.colorPrimary });

  return (
    <div className="jini-component-kit-preview" style={style} data-theme={theme}>
      <div className="jini-component-kit-preview__head">
        <strong>{t('Preview')}</strong>
        <span>{t('Component kit')}</span>
      </div>
      <div className="jini-component-kit-preview__kit">
        <div className="jini-component-kit-preview__tabs">
          <button type="button" className={theme === 'light' ? 'active' : ''} aria-pressed={theme === 'light'} onClick={() => onThemeChange('light')}>
            {t('Light')}
          </button>
          <button type="button" className={theme === 'dark' ? 'active' : ''} aria-pressed={theme === 'dark'} onClick={() => onThemeChange('dark')}>
            {t('Dark')}
          </button>
          <span>{t('Component kit')}</span>
        </div>
        <div className="jini-component-kit-preview__stage">
          <span className="jini-component-kit-preview__badge">{tokens.name} · {t('Default theme')}</span>
          <h3>{t('Component kit for {name}', { name: tokens.name })}</h3>
          <p>{tokens.description || t('A generated component style guide.')}</p>
          <div className="jini-component-kit-preview__specimen">
            <section>
              <h4>{t('Buttons')}</h4>
              <small>{t('Common button variants at this theme\'s tokens.')}</small>
              <div className="jini-component-kit-preview__button-row">
                <button type="button" className="primary" style={{ color: primaryText }}>{t('Primary')}</button>
                <button type="button">{t('Default')}</button>
                <button type="button" className="dashed">{t('Dashed')}</button>
                <button type="button" className="text">{t('Text')}</button>
                <button type="button" className="link">{t('Link')}</button>
              </div>
              <div className="jini-component-kit-preview__size-row">
                <button type="button" className="primary small" style={{ color: primaryText }}>{t('Small')}</button>
                <button type="button" className="primary" style={{ color: primaryText }}>{t('Medium')}</button>
                <button type="button" className="primary large" style={{ color: primaryText }}>{t('Large')}</button>
              </div>
            </section>
            <section>
              <h4>{t('Type scale')}</h4>
              <small>{tokens.displayFont} · {tokens.bodyFont}</small>
              <div className="jini-component-kit-preview__type-row">
                <strong>Aa</strong>
                <span>Aa</span>
                <small>Aa</small>
              </div>
            </section>
          </div>
        </div>
      </div>
      <div className="jini-component-kit-preview__token-row" aria-label={t('Extracted tokens')}>
        <TokenChip label="colorPrimary" hex={tokens.colorPrimary} />
        <TokenChip label="colorPrimaryBg" hex={tokens.colorPrimaryBg} />
        <TokenChip label="colorPrimaryHover" hex={tokens.colorPrimaryHover} />
        <TokenChip label="colorPrimaryActive" hex={tokens.colorPrimaryActive} />
        <ValueChip label="fontSize" value={String(tokens.fontSize)} />
        <ValueChip label="borderRadius" value={String(tokens.radius)} />
      </div>
    </div>
  );
}
