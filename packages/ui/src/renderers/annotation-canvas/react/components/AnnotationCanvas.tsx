/**
 * `<AnnotationCanvas>` — draws freehand/box/text marks over arbitrary
 * preview content (`children`: an artifact iframe, a webview, anything) and
 * offers a send/draft/queue submit-action picker. All state/interaction
 * logic lives in `useAnnotationCanvas`; this component is the presentational
 * shell.
 *
 * Origin: `apps/web/src/components/PreviewDrawOverlay.tsx`. See
 * `../../source-map.md`.
 */
import { createPortal } from 'react-dom';
import type { ReactElement, ReactNode } from 'react';
import type { AnnotationCanvasPort } from '../../ports.js';
import type { CaptureTarget, DrawToolbarElement, AnnotationAction, MarkTool } from '../../types.js';
import {
  useAnnotationCanvas,
  type AnnotationCanvasController,
  type TextMarkController,
} from '../hooks/useAnnotationCanvas.js';
import { DEFAULT_ANNOTATION_CANVAS_ICONS, type AnnotationCanvasIconName } from './icons.js';
import { useT } from '../../../react/i18n.js';

export interface AnnotationCanvasProps {
  children: ReactNode;
  active: boolean;
  onActiveChange?: ((active: boolean) => void) | undefined;
  captureViewport?: boolean | undefined;
  captureTarget?: CaptureTarget | null | undefined;
  filePath?: string | undefined;
  sendDisabled?: boolean | undefined;
  sendDisabledReason?: string | undefined;
  hideChrome?: boolean | undefined;
  onToolbarClick?: ((element: DrawToolbarElement, submitAction?: AnnotationAction) => void) | undefined;
  port: AnnotationCanvasPort;
  /** Renders the toolbar/dock into this element via a portal instead of inline (useful to escape a clipped, scaled ancestor). Omit to render inline. */
  toolbarHost?: HTMLElement | null | undefined;
  /** Override any of the toolbar's icons; unset ones fall back to a small built-in generic set (see `icons.tsx`). */
  icons?: Partial<Record<AnnotationCanvasIconName, () => ReactElement>> | undefined;
  className?: string | undefined;
}

function maybePortal(node: ReactNode, host: HTMLElement | null | undefined) {
  return host ? createPortal(node, host) : node;
}

/** Crosshair for drawing tools, an I-beam for the text tool, the default pointer while inactive. */
function annotationCursor(active: boolean, markTool: MarkTool): string {
  if (!active) return 'default';
  return markTool === 'text' ? 'text' : 'crosshair';
}

export function AnnotationCanvas(props: AnnotationCanvasProps) {
  const { children, toolbarHost, icons: iconOverrides, className } = props;
  const icons = { ...DEFAULT_ANNOTATION_CANVAS_ICONS, ...iconOverrides };
  const c = useAnnotationCanvas(props);

  // `c.imagePreviews[c.previewIndex]` is a TS-only possibly-undefined lookup
  // (`noUncheckedIndexedAccess`): `previewIndex` is only ever set to a
  // currently-valid index (the thumbnail's own `onClick={() =>
  // c.setPreviewIndex(i)}` closes over the same array it maps over), and
  // every state change that could shrink `imagePreviews` (`removeExtraFile`)
  // unconditionally resets `previewIndex` to `null` in that same update — so
  // this can never actually be `undefined` while `previewIndex !== null`.
  const activePreview = c.previewIndex !== null ? c.imagePreviews[c.previewIndex]! : null;

  return (
    <div
      ref={c.wrapRef}
      className={className}
      data-annotation-canvas-active={props.active ? 'true' : 'false'}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    >
      {children}
      {c.showCanvas ? <DrawingCanvas c={c} active={props.active} /> : null}
      {c.textLayerVisible ? <TextLayer c={c} icons={icons} /> : null}
      {props.active
        ? maybePortal(<AnnotationDock c={c} icons={icons} onToolbarClick={props.onToolbarClick} />, toolbarHost)
        : null}
      {activePreview && typeof document !== 'undefined'
        ? createPortal(<ImagePreviewDialog c={c} icons={icons} preview={activePreview} />, document.body)
        : null}
    </div>
  );
}

type CanvasIcons = Record<AnnotationCanvasIconName, () => ReactElement>;
type ImagePreview = AnnotationCanvasController['imagePreviews'][number];

function DrawingCanvas({ c, active }: { c: AnnotationCanvasController; active: boolean }) {
  return (
    <canvas
      ref={c.canvasRef}
      onPointerDown={c.onPointerDown}
      onPointerMove={c.onPointerMove}
      onPointerUp={c.onPointerUp}
      onPointerCancel={c.onPointerUp}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: active ? 'auto' : 'none',
        cursor: annotationCursor(active, c.markTool),
        visibility: c.chromeHidden ? 'hidden' : 'visible',
        touchAction: 'none',
        userSelect: 'none',
      }}
    />
  );
}

function TextLayer({ c, icons }: { c: AnnotationCanvasController; icons: CanvasIcons }) {
  return (
    <div
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', visibility: c.chromeHidden ? 'hidden' : 'visible' }}
    >
      {c.textMarks.map((mark) => (
        <TextMarkItem key={mark.id} c={c} icons={icons} mark={mark} />
      ))}
    </div>
  );
}

function TextMarkItem({ c, icons, mark }: { c: AnnotationCanvasController; icons: CanvasIcons; mark: TextMarkController }) {
  const t = useT();
  return (
    <div
      onPointerDown={(e) => c.onTextPointerDown(e, mark)}
      onPointerMove={(e) => c.onTextPointerMove(e, mark)}
      onPointerUp={(e) => c.onTextPointerUp(e, mark)}
      onPointerCancel={(e) => c.onTextPointerUp(e, mark)}
      style={{
        position: 'absolute',
        left: `${mark.x * 100}%`,
        top: `${mark.y * 100}%`,
        pointerEvents: c.markTool === 'text' ? 'auto' : 'none',
        cursor: mark.editing ? 'default' : 'move',
        touchAction: 'none',
      }}
    >
      <textarea
        ref={(el) => {
          c.registerTextArea(mark.id, el);
          if (el) c.autosizeTextArea(el);
        }}
        value={mark.text}
        wrap="off"
        rows={1}
        spellCheck={false}
        readOnly={!mark.editing}
        aria-label={t('Text annotation')}
        onChange={(e) => {
          c.updateTextMark(mark.id, e.target.value);
          c.autosizeTextArea(e.currentTarget);
        }}
        onBlur={() => c.handleTextBlur(mark.id)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            c.handleTextEscape(mark.id, e.currentTarget);
          }
        }}
        style={{
          display: 'block',
          margin: 0,
          padding: 0,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          resize: 'none',
          overflow: 'hidden',
          whiteSpace: 'pre',
          color: 'var(--jini-danger)',
          caretColor: 'var(--jini-danger)',
          fontWeight: 600,
          fontSize: c.textFontPx,
          lineHeight: 1.25,
          minWidth: Math.max(2, Math.round(c.textFontPx * 0.5)),
          pointerEvents: mark.editing ? 'auto' : 'none',
          userSelect: mark.editing ? 'text' : 'none',
          cursor: mark.editing ? 'text' : 'move',
        }}
      />
      {c.markTool === 'text' ? (
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={() => c.removeTextMark(mark.id)}
          aria-label={t('Remove text annotation')}
          title={t('Remove text annotation')}
        >
          {icons.close()}
        </button>
      ) : null}
    </div>
  );
}

function AnnotationDock({
  c,
  icons,
  onToolbarClick,
}: {
  c: AnnotationCanvasController;
  icons: CanvasIcons;
  onToolbarClick: AnnotationCanvasProps['onToolbarClick'];
}) {
  const t = useT();
  return (
    <div
      ref={c.dockRef}
      data-annotation-canvas-dock-layout={c.dockPlacement.layout}
      data-annotation-canvas-dock-side={c.dockPlacement.side ?? undefined}
      style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, ...c.dockPlacement.style }}
    >
      {c.captureWarning ? (
        <div role="status" aria-live="polite" style={{ visibility: c.chromeHidden ? 'hidden' : undefined }}>
          <span>{c.captureWarning.message}</span>
        </div>
      ) : null}
      {c.imagePreviews.length > 0 ? <AttachedImages c={c} icons={icons} /> : null}
      <div
        role="toolbar"
        aria-label={t('Annotation tools')}
        style={{ display: 'flex', alignItems: 'center', gap: 6, visibility: c.chromeHidden ? 'hidden' : undefined }}
      >
        <MarkToolPicker c={c} icons={icons} />
        <button type="button" onClick={c.undoStroke} disabled={!c.canUndo} aria-label={t('Undo')} title={t('Undo')}>
          {icons.undo()}
        </button>
        <button type="button" onClick={c.redoStroke} disabled={!c.canRedo} aria-label={t('Redo')} title={t('Redo')}>
          {icons.redo()}
        </button>
        <input
          ref={c.fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={c.onFileInputChange}
        />
        <button
          type="button"
          onClick={() => {
            onToolbarClick?.('attach_image');
            c.fileInputRef.current?.click();
          }}
          disabled={c.sending}
          aria-label={t('Attach image')}
          title={t('Attach image')}
        >
          {icons.attach()}
        </button>
        <input
          value={c.note}
          onChange={(e) => c.setNote(e.target.value)}
          onPaste={c.onNotePaste}
          disabled={c.sending}
          placeholder={t('Add a note…')}
          aria-label={t('Annotation note')}
          onCompositionStart={c.onCompositionStart}
          onCompositionEnd={c.onCompositionEnd}
          onKeyDown={c.onNoteKeyDown}
        />
        <SubmitPicker c={c} icons={icons} />
      </div>
      <button
        type="button"
        onClick={() => {
          onToolbarClick?.('exit');
          c.closeOverlay();
        }}
        disabled={c.sending}
        aria-label={t('Close annotation tools')}
        title={t('Close annotation tools')}
      >
        {icons.close()}
      </button>
    </div>
  );
}

function AttachedImages({ c, icons }: { c: AnnotationCanvasController; icons: CanvasIcons }) {
  const t = useT();
  return (
    <div aria-label={t('Attached images')} style={{ display: 'flex', gap: 6, visibility: c.chromeHidden ? 'hidden' : undefined }}>
      {c.imagePreviews.map((item, i) => (
        <div key={item.url} style={{ position: 'relative' }}>
          <button type="button" onClick={() => c.setPreviewIndex(i)} disabled={c.sending} title={item.file.name} aria-label={item.file.name}>
            <img src={item.url} alt="" aria-hidden style={{ width: 44, height: 44, objectFit: 'cover' }} />
          </button>
          <button
            type="button"
            onClick={() => c.removeExtraFile(i)}
            disabled={c.sending}
            aria-label={t('Remove attached image')}
            title={t('Remove attached image')}
          >
            {icons.close()}
          </button>
        </div>
      ))}
    </div>
  );
}

function MarkToolPicker({ c, icons }: { c: AnnotationCanvasController; icons: CanvasIcons }) {
  return (
    <div style={{ position: 'relative' }} ref={c.markToolMenuRef}>
      <button
        type="button"
        onClick={() => c.setMarkToolMenuOpen(!c.markToolMenuOpen)}
        disabled={c.sending}
        aria-haspopup="menu"
        aria-expanded={c.markToolMenuOpen}
        aria-label={c.currentMarkTool.label}
        title={c.currentMarkTool.label}
      >
        {icons[c.currentMarkTool.tool]()}
        {icons['chevron-down']()}
      </button>
      {c.markToolMenuOpen ? (
        <div role="menu" aria-label={c.currentMarkTool.label}>
          {c.markToolOptions.map((item) => {
            const isActive = c.markTool === item.tool;
            return (
              <button
                key={item.tool}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                aria-label={item.label}
                disabled={c.sending}
                onClick={() => c.selectMarkTool(item.tool)}
              >
                {icons[item.tool]()}
                <span>{item.label}</span>
                {isActive ? icons.check() : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SubmitPicker({ c, icons }: { c: AnnotationCanvasController; icons: CanvasIcons }) {
  const t = useT();
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }} ref={c.submitMenuRef}>
      <button
        type="button"
        onClick={() => void c.send(c.submitAction)}
        disabled={c.sending || !c.currentSubmit.enabled}
        aria-label={c.sending ? c.currentSubmit.pendingLabel : c.currentSubmit.label}
        title={c.sending ? c.currentSubmit.pendingLabel : c.currentSubmit.title}
      >
        {c.sending ? icons.spinner() : icons[c.submitAction]()}
        <span>{c.currentSubmit.label}</span>
      </button>
      <button
        type="button"
        onClick={() => c.setSubmitMenuOpen(!c.submitMenuOpen)}
        disabled={c.sending || !c.canSubmit}
        aria-haspopup="menu"
        aria-expanded={c.submitMenuOpen}
        aria-label={t('Submit options')}
        title={t('Submit options')}
      >
        {c.submitMenuOpen ? icons['chevron-down']() : icons['chevron-up']()}
      </button>
      {c.submitMenuOpen ? (
        <div role="menu" aria-label={t('Submit options')}>
          {c.submitOptions.map((opt) => {
            const isActive = c.submitAction === opt.action;
            return (
              <button
                key={opt.action}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                aria-label={opt.label}
                disabled={!c.sending && opt.enabled ? undefined : true}
                title={opt.title}
                onClick={() => c.chooseSubmitAction(opt.action)}
              >
                {icons[opt.action]()}
                <span>{opt.label}</span>
                {isActive ? icons.check() : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ImagePreviewDialog({ c, icons, preview }: { c: AnnotationCanvasController; icons: CanvasIcons; preview: ImagePreview }) {
  const t = useT();
  return (
    <div role="dialog" aria-modal="true" aria-label={preview.file.name} onMouseDown={(e) => {
      if (e.target === e.currentTarget) c.setPreviewIndex(null);
    }}>
      <div>
        <div>
          <span title={preview.file.name}>{preview.file.name}</span>
          <button type="button" onClick={() => c.setPreviewIndex(null)} aria-label={t('Close')} title={t('Close')}>
            {icons.close()}
          </button>
        </div>
        <img src={preview.url} alt={preview.file.name} />
      </div>
    </div>
  );
}
