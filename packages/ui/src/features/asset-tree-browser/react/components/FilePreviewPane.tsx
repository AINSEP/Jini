import type { ReactNode } from 'react';
import { useT } from '../../../i18n/index.js';
import { Icon } from '../../../../react/components/Icon.js';
import { fileExtensionLabel, humanBytes, relativeTimeResult } from '../../rules.js';

export interface FilePreviewPaneProps<TFile> {
  file: TFile;
  /** Full path from the tree root (NOT basename-relative-to-directory — the preview pane always shows the full path, unlike a row's truncated display name). */
  path: string;
  kindLabel: string;
  kindGlyph: string;
  size: number;
  modifiedAt: number;
  onOpen: () => void;
  onClose: () => void;
  /** Omit to hide the Download link (no `getFileUrl` was supplied to `AssetTreeBrowser`). */
  downloadHref?: string | undefined;
  /**
   * Host-supplied, kind-aware thumbnail. Defaults to a generic glyph
   * placeholder — this package ships no file-kind-specific rendering (no
   * HTML-iframe preview, no design-canvas preview; see
   * `archived UI source map` for what the origin `DesignFilesPanel`
   * shipped there instead and why it isn't ported).
   */
  renderThumbnail?: ((file: TFile) => ReactNode) | undefined;
  /**
   * True when `renderThumbnail` renders its own interactive controls (e.g.
   * native `<video>`/`<audio>` controls) that this pane's click-to-open
   * overlay button would otherwise intercept clicks from. Defaults to
   * `false`. Generifies the origin's hardcoded `kind !== 'audio' && kind
   * !== 'video'` check, which this package can't reproduce since it has no
   * concept of a fixed kind enum.
   */
  thumbnailIsInteractive?: boolean | undefined;
}

/**
 * The right-side preview pane: a thumbnail slot, a meta footer (name / kind
 * / modified-time + size + extension / download link), and an "Open" action
 * — the `AssetTreeBrowser`'s companion surface for whichever file is
 * currently previewed.
 */
export function FilePreviewPane<TFile>({
  file,
  path,
  kindLabel,
  kindGlyph,
  size,
  modifiedAt,
  onOpen,
  onClose,
  downloadHref,
  renderThumbnail,
  thumbnailIsInteractive = false,
  useTHook = useT,
}: FilePreviewPaneProps<TFile> & { useTHook?: typeof useT }) {
  const t = useTHook();
  const relativeTime = relativeTimeResult({ ts: modifiedAt });
  const timeLabel = relativeTime.translatable ? t(relativeTime.label, relativeTime.params) : relativeTime.label;
  const openLabel = `${t('Open')} ${path}`;

  return (
    <aside className="asset-tree-preview" data-testid="asset-tree-preview">
      <button
        type="button"
        className="asset-tree-preview-close"
        onClick={onClose}
        title={t('Close preview')}
        aria-label={t('Close preview')}
      >
        <Icon name="close" size={13} />
      </button>
      <div className="asset-tree-preview-thumb">
        {renderThumbnail ? (
          renderThumbnail(file)
        ) : (
          <div className="asset-tree-preview-placeholder" aria-hidden>
            {kindGlyph}
          </div>
        )}
        {thumbnailIsInteractive ? null : (
          <button
            type="button"
            className="asset-tree-preview-thumb-open"
            onClick={onOpen}
            title={openLabel}
            aria-label={openLabel}
          />
        )}
      </div>
      <div className="asset-tree-preview-meta">
        <button type="button" className="asset-tree-preview-open-cta" onClick={onOpen}>
          <Icon name="eye" size={14} />
          <span>{t('Open')}</span>
        </button>
        <div className="asset-tree-preview-name">{path}</div>
        <div className="asset-tree-preview-kind">{kindLabel}</div>
        <div className="asset-tree-preview-stats">
          {t('Modified {time} · {size} · {ext}', {
            time: timeLabel,
            size: humanBytes({ n: size }),
            ext: fileExtensionLabel({ path }),
          })}
        </div>
        {downloadHref ? (
          <a className="asset-tree-preview-download" href={downloadHref} download={path}>
            <Icon name="download" size={13} />
            <span>{t('Download')}</span>
          </a>
        ) : null}
      </div>
    </aside>
  );
}
