import type { ReactNode } from 'react';
import { Icon } from '../../../../react/components/Icon.js';
import { useT } from '../../../i18n/index.js';
import { FILE_DROPZONE_FONT_SPECIMEN, FILE_DROPZONE_GLYPH_ICON, FILE_DROPZONE_TEXT_THUMB_CHARS } from '../../constants.js';
import { fileDropzoneExtensionLabel, fileDropzoneKind, fileDropzoneStagingKey } from '../../rules.js';
import type { FileDropzoneKind, FileDropzonePreviewState } from '../../types.js';

export interface FileDropzoneThumbnailGridProps {
  files: readonly File[];
  previews: FileDropzonePreviewState;
  onSelect: (file: File) => void;
  onRemove?: ((file: File) => void) | undefined;
}

function renderGlyph({ file, kind }: { file: File; kind: FileDropzoneKind }) {
  return (
    <span className="jini-file-dropzone__glyph" data-kind={kind}>
      <Icon name={FILE_DROPZONE_GLYPH_ICON[kind]} size={20} />
      <span className="jini-file-dropzone__glyph-ext">{fileDropzoneExtensionLabel(file)}</span>
    </span>
  );
}

type ThumbRenderer = (input: { file: File; previews: FileDropzonePreviewState }) => ReactNode;

/**
 * Per-kind thumbnail renderers. Each returns `null` while its preview source
 * (object URL, loaded font family, non-blank text snippet) is not available
 * yet, so `renderThumb` falls back to the extension glyph. Kinds with no entry
 * (pdf/audio/slides/other) always render the glyph.
 */
const THUMB_RENDERERS: Partial<Record<FileDropzoneKind, ThumbRenderer>> = {
  image: ({ file, previews }) => {
    const url = previews.previewUrls.get(file);
    return url ? <img src={url} alt="" className="jini-file-dropzone__thumb" loading="lazy" /> : null;
  },
  video: ({ file, previews }) => {
    const url = previews.previewUrls.get(file);
    return url ? (
      <video className="jini-file-dropzone__thumb" src={url} muted playsInline preload="metadata" tabIndex={-1} />
    ) : null;
  },
  font: ({ file, previews }) => {
    const family = previews.fontFamilies.get(file);
    return family ? (
      <span className="jini-file-dropzone__font-thumb" style={{ fontFamily: `'${family}'` }} aria-hidden>
        {FILE_DROPZONE_FONT_SPECIMEN}
      </span>
    ) : null;
  },
  html: ({ file, previews }) => {
    const url = previews.previewUrls.get(file);
    return url ? (
      <span className="jini-file-dropzone__frame-thumb" aria-hidden>
        <iframe className="jini-file-dropzone__html-thumb" src={url} title="" sandbox="" tabIndex={-1} />
      </span>
    ) : null;
  },
  text: ({ file, previews }) => {
    const snippet = previews.textSnippets.get(file);
    return snippet?.trim() ? (
      <span className="jini-file-dropzone__text-thumb" aria-hidden>
        {snippet.slice(0, FILE_DROPZONE_TEXT_THUMB_CHARS)}
      </span>
    ) : null;
  },
};

function renderThumb({ file, kind, previews }: { file: File; kind: FileDropzoneKind; previews: FileDropzonePreviewState }) {
  return THUMB_RENDERERS[kind]?.({ file, previews }) ?? renderGlyph({ file, kind });
}

/** Kind-aware thumbnail grid over staged files, with remove tiles and click-to-select (the host renders the lightbox — see `FileDropzoneLightbox`). Ported from `DesignSystemAssetDropzone.tsx`'s staged-asset grid. */
export function FileDropzoneThumbnailGrid({ files, previews, onSelect, onRemove }: FileDropzoneThumbnailGridProps) {
  const t = useT();
  if (files.length === 0) return null;
  return (
    <ul className="jini-file-dropzone__grid" aria-label={t('Staged files')}>
      {files.map((file) => {
        const kind = fileDropzoneKind(file);
        return (
          <li key={fileDropzoneStagingKey(file)} className="jini-file-dropzone__tile">
            <button
              type="button"
              className="jini-file-dropzone__tile-main"
              onClick={() => onSelect(file)}
              title={file.name}
            >
              {renderThumb({ file, kind, previews })}
            </button>
            {onRemove ? (
              <button
                type="button"
                className="jini-file-dropzone__remove"
                aria-label={t('Remove {name}', { name: file.name })}
                onClick={() => onRemove(file)}
              >
                <Icon name="close" size={12} />
              </button>
            ) : null}
            <span className="jini-file-dropzone__caption" title={file.name}>
              {file.name}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
