import { useRef, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from 'react';
import { useT } from '../../../i18n/index.js';
import { SegmentedToggle } from './SegmentedToggle.js';
import { ViewerShell } from './ViewerShell.js';
import { useMarkdownScrollSync, type UseMarkdownScrollSyncResult } from '../hooks/useMarkdownScrollSync.js';
import type { MarkdownSplitPaneMode } from '../../types.js';

export interface MarkdownSplitPaneProps {
  mode: MarkdownSplitPaneMode;
  onModeChange: (mode: MarkdownSplitPaneMode) => void;
  sourceText: string;
  onSourceChange: (text: string) => void;
  /** Host-rendered markdown HTML (`renderMarkdownToSafeHtml`-shaped — the
   *  actual renderer, shiki highlighting, and image-src-rewriting are all
   *  genuinely OD/product-specific and were not ported; see
   *  `packages/ui/source-map.md`). `null` while loading. */
  previewHtml: string | null;
  /** CSS selector for the rendered preview's root element, forwarded to the
   *  scroll-sync measurement (default `.markdown-rendered`). */
  previewSelector?: string;
  loading?: boolean;
  loadingLabel?: string;
  sourceLabel?: string;
  splitLabel?: string;
  previewLabel?: string;
  editorAriaLabel?: string;
  previewAriaLabel?: string;
  modeAriaLabel?: string;
  /** Extra left-of-tabs toolbar content (e.g. a host's streaming/error
   *  status label). */
  toolbarLeftExtra?: ReactNode;
  /** Right-aligned toolbar content — a host's save-status indicator,
   *  copy/download buttons, etc. (all genuinely host-specific). */
  toolbarActions?: ReactNode;
  /** Extra props spread onto the editor `<textarea>` (e.g. `onPaste`/
   *  `onDrop` handlers a host wires for image upload — not implemented
   *  here, since that's a product-specific upload pipeline). */
  editorTextareaProps?: Record<string, unknown>;
  /** Click handler on the rendered preview `<article>` — a host uses this
   *  to delegate code-block "copy" button clicks, etc. */
  onPreviewClick?: (event: ReactMouseEvent<HTMLElement>) => void;
}

/**
 * The generic core of the source component's `MarkdownViewer`: a
 * source/split/preview mode toggle plus a two-pane layout whose scroll
 * positions stay aligned via block-anchored scroll-sync
 * (`useMarkdownScrollSync`). Ported without the artifact-status gate that
 * the extraction plan called out — and, per a closer read than the plan's
 * one-line description, also without the autosave/debounce-write pipeline,
 * image paste/drop upload, and shiki-based code-block syntax highlighting,
 * all of which are genuinely product/daemon-specific (see
 * `packages/ui/source-map.md` for the full disclosure). A host renders its
 * own markdown-to-HTML pipeline and passes the result as `previewHtml`.
 */
export function MarkdownSplitPane({
  mode,
  onModeChange,
  sourceText,
  onSourceChange,
  previewHtml,
  previewSelector,
  loading = false,
  loadingLabel,
  sourceLabel,
  splitLabel,
  previewLabel,
  editorAriaLabel,
  previewAriaLabel,
  modeAriaLabel,
  toolbarLeftExtra,
  toolbarActions,
  editorTextareaProps,
  onPreviewClick,
}: MarkdownSplitPaneProps) {
  const t = useT();
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const previewRef = useRef<HTMLElement | null>(null);

  const { handleEditorScroll, handlePreviewScroll, activatePane } = useMarkdownScrollSync({
    mode,
    sourceText,
    editorRef,
    previewRef,
    previewSelector,
    resyncKey: previewHtml,
  });

  const showEditor = mode === 'source' || mode === 'split';
  const showPreview = mode === 'preview' || mode === 'split';
  const isLoading = loading || previewHtml === null;

  return (
    <ViewerShell
      kindClassName="markdown-split-viewer"
      bodyClassName={`markdown-workbench markdown-workbench-${mode}`}
      toolbarLeft={
        <>
          {toolbarLeftExtra}
          <MarkdownModeTabs
            mode={mode}
            onModeChange={onModeChange}
            sourceLabel={sourceLabel}
            splitLabel={splitLabel}
            previewLabel={previewLabel}
            modeAriaLabel={modeAriaLabel}
          />
        </>
      }
      toolbarActions={toolbarActions}
    >
      {isLoading ? (
        <div className="viewer-empty">{loadingLabel ?? t('Loading…')}</div>
      ) : (
        <>
          {showEditor ? (
            <MarkdownEditorPane
              editorRef={editorRef}
              sourceText={sourceText}
              onSourceChange={onSourceChange}
              ariaLabel={editorAriaLabel}
              onScroll={handleEditorScroll}
              activatePane={activatePane}
              textareaProps={editorTextareaProps}
            />
          ) : null}
          {showPreview ? (
            <MarkdownPreviewPane
              previewRef={previewRef}
              // Non-null assertion: `isLoading` (above) is true whenever
              // `previewHtml === null`, and this JSX only renders in the
              // `!isLoading` branch — so `previewHtml` is always a string
              // here. TypeScript can't follow that indirect invariant
              // through the derived `isLoading` boolean, hence the `!`.
              html={previewHtml!}
              ariaLabel={previewAriaLabel}
              onScroll={handlePreviewScroll}
              activatePane={activatePane}
              onPreviewClick={onPreviewClick}
            />
          ) : null}
        </>
      )}
    </ViewerShell>
  );
}

type ActivatePane = UseMarkdownScrollSyncResult['activatePane'];
type PaneScrollHandler = UseMarkdownScrollSyncResult['handleEditorScroll'];

function MarkdownModeTabs({
  mode,
  onModeChange,
  sourceLabel,
  splitLabel,
  previewLabel,
  modeAriaLabel,
}: {
  mode: MarkdownSplitPaneMode;
  onModeChange: (mode: MarkdownSplitPaneMode) => void;
  sourceLabel: string | undefined;
  splitLabel: string | undefined;
  previewLabel: string | undefined;
  modeAriaLabel: string | undefined;
}) {
  const t = useT();
  return (
    <SegmentedToggle
      className="markdown-mode-tabs"
      ariaLabel={modeAriaLabel ?? t('Markdown view mode')}
      value={mode}
      onChange={onModeChange}
      options={[
        { value: 'source', label: sourceLabel ?? t('Source') },
        { value: 'split', label: splitLabel ?? t('Split') },
        { value: 'preview', label: previewLabel ?? t('Preview') },
      ]}
    />
  );
}

function MarkdownEditorPane({
  editorRef,
  sourceText,
  onSourceChange,
  ariaLabel,
  onScroll,
  activatePane,
  textareaProps,
}: {
  editorRef: RefObject<HTMLTextAreaElement | null>;
  sourceText: string;
  onSourceChange: (text: string) => void;
  ariaLabel: string | undefined;
  onScroll: PaneScrollHandler;
  activatePane: ActivatePane;
  textareaProps: Record<string, unknown> | undefined;
}) {
  const t = useT();
  const label = ariaLabel ?? t('Markdown editor');
  return (
    <section className="markdown-editor-pane" aria-label={label}>
      <textarea
        ref={editorRef}
        className="markdown-editor"
        value={sourceText}
        aria-label={label}
        spellCheck
        onFocus={() => activatePane('editor')}
        onChange={(event) => {
          activatePane('editor');
          onSourceChange(event.currentTarget.value);
        }}
        onScroll={onScroll}
        {...textareaProps}
      />
    </section>
  );
}

function MarkdownPreviewPane({
  previewRef,
  html,
  ariaLabel,
  onScroll,
  activatePane,
  onPreviewClick,
}: {
  previewRef: RefObject<HTMLElement | null>;
  html: string;
  ariaLabel: string | undefined;
  onScroll: PaneScrollHandler;
  activatePane: ActivatePane;
  onPreviewClick: MarkdownSplitPaneProps['onPreviewClick'];
}) {
  const t = useT();
  const activatePreview = () => activatePane('preview');
  return (
    <div className="markdown-preview-pane-wrap">
      <section
        ref={previewRef}
        className="markdown-preview-pane"
        aria-label={ariaLabel ?? t('Markdown preview')}
        onPointerDown={activatePreview}
        onWheel={activatePreview}
        onTouchStart={activatePreview}
        onKeyDown={activatePreview}
        onFocus={activatePreview}
        onScroll={onScroll}
      >
        {/* Trusting `previewHtml` is the host's responsibility — this
            component renders whatever HTML string it's given. */}
        <article className="markdown-rendered" onClick={onPreviewClick} dangerouslySetInnerHTML={{ __html: html }} />
      </section>
    </div>
  );
}
