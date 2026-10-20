import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../../../react/components/Icon.js';
import { useT } from '../../../i18n/index.js';
import type { TranslationVars } from '../../../i18n/index.js';
import { FILE_DROPZONE_FONT_PANGRAM, FILE_DROPZONE_FONT_SPECIMEN, FILE_DROPZONE_GLYPH_ICON } from '../../constants.js';
import { fileDropzoneExtensionLabel, fileDropzoneKind, fileDropzoneSizeLabel } from '../../rules.js';
import type { FileDropzoneKind, FileDropzonePreviewState } from '../../types.js';

export interface FileDropzoneLightboxProps {
  file: File;
  previews: FileDropzonePreviewState;
  onClose: () => void;
}

type Translate = (key: string, vars?: TranslationVars) => string;

interface StageInput {
  t: Translate;
  file: File;
  previews: FileDropzonePreviewState;
}

type StageRenderer = (input: StageInput) => ReactNode;

/** Renders `render(url)` once the file's object URL has resolved, `null` (→ fallback card) until then. */
function withUrl(render: (url: string, file: File) => ReactNode): StageRenderer {
  return ({ file, previews }) => {
    const url = previews.previewUrls.get(file);
    return url ? render(url, file) : null;
  };
}

/**
 * Per-kind stage renderers. Each returns `null` while its preview source is
 * not available yet (no object URL, no loaded font family, no text snippet),
 * so `renderStage` shows the name/size fallback card. Kinds with no entry
 * (slides/other) always render the fallback card.
 */
const STAGE_RENDERERS: Partial<Record<FileDropzoneKind, StageRenderer>> = {
  image: withUrl((url, file) => <img src={url} alt={file.name} className="jini-file-dropzone__lightbox-img" />),
  video: withUrl((url) => <video src={url} className="jini-file-dropzone__lightbox-video" controls autoPlay playsInline />),
  audio: withUrl((url) => (
    <div className="jini-file-dropzone__lightbox-audio">
      <span className="jini-file-dropzone__lightbox-audio-icon">
        <Icon name="volume" size={34} />
      </span>
      <audio src={url} controls className="jini-file-dropzone__lightbox-audio-player" />
    </div>
  )),
  pdf: withUrl((url, file) => <iframe src={url} className="jini-file-dropzone__lightbox-frame" title={file.name} />),
  html: withUrl((url, file) => (
    <iframe
      src={url}
      className="jini-file-dropzone__lightbox-frame"
      title={file.name}
      sandbox="allow-scripts allow-popups"
    />
  )),
  font: ({ file, previews }) => {
    const family = previews.fontFamilies.get(file);
    if (!family) return null;
    return (
      <div className="jini-file-dropzone__lightbox-font" style={{ fontFamily: `'${family}'` }}>
        <div className="jini-file-dropzone__lightbox-font-hero">{FILE_DROPZONE_FONT_SPECIMEN}Bb Cc</div>
        <div className="jini-file-dropzone__lightbox-font-pangram">{FILE_DROPZONE_FONT_PANGRAM}</div>
        <div className="jini-file-dropzone__lightbox-font-scale">
          <span style={{ fontSize: 13 }}>{FILE_DROPZONE_FONT_PANGRAM}</span>
          <span style={{ fontSize: 18 }}>{FILE_DROPZONE_FONT_PANGRAM}</span>
          <span style={{ fontSize: 26 }}>{FILE_DROPZONE_FONT_PANGRAM}</span>
        </div>
      </div>
    );
  },
  text: ({ t, file, previews }) => {
    const snippet = previews.textSnippets.get(file);
    return snippet != null ? <pre className="jini-file-dropzone__lightbox-text">{snippet || t('(empty file)')}</pre> : null;
  },
};

function renderFallback({ t, file, kind }: { t: Translate; file: File; kind: FileDropzoneKind }) {
  return (
    <div className="jini-file-dropzone__lightbox-fallback">
      <span className="jini-file-dropzone__lightbox-fallback-glyph" data-kind={kind}>
        <Icon name={FILE_DROPZONE_GLYPH_ICON[kind]} size={40} />
      </span>
      <p className="jini-file-dropzone__lightbox-fallback-name">{file.name}</p>
      <p className="jini-file-dropzone__lightbox-fallback-meta">
        {fileDropzoneExtensionLabel(file)} · {fileDropzoneSizeLabel(file.size) || '—'}
      </p>
      <p className="jini-file-dropzone__lightbox-fallback-hint">{t('No inline preview for this file type.')}</p>
    </div>
  );
}

function renderStage({ t, file, kind, previews }: StageInput & { kind: FileDropzoneKind }) {
  return STAGE_RENDERERS[kind]?.({ t, file, previews }) ?? renderFallback({ t, file, kind });
}

/** Click-to-enlarge, kind-aware preview for one staged file — image, PDF embed, HTML mini-render, video/audio player, font specimen, or a text snippet, with a name/size fallback card for everything else. Portaled to `document.body`. Ported from `DesignSystemAssetDropzone.tsx`'s lightbox. */
export function FileDropzoneLightbox({ file, previews, onClose }: FileDropzoneLightboxProps) {
  const t = useT();
  const kind = fileDropzoneKind(file);
  return createPortal(
    <div className="jini-file-dropzone__lightbox" onClick={onClose} role="presentation">
      <div
        className="jini-file-dropzone__lightbox-inner"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={file.name}
      >
        <div className="jini-file-dropzone__lightbox-stage" data-kind={kind}>
          {renderStage({ t, file, kind, previews })}
        </div>
        <div className="jini-file-dropzone__lightbox-bar">
          <span className="jini-file-dropzone__lightbox-name" title={file.name}>
            {file.name}
          </span>
          <span className="jini-file-dropzone__lightbox-meta">{fileDropzoneSizeLabel(file.size)}</span>
          <button
            type="button"
            className="jini-file-dropzone__lightbox-close"
            onClick={onClose}
            aria-label={t('Close preview')}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
