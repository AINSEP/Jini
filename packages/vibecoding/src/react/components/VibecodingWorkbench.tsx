/**
 * @module react/components/VibecodingWorkbench
 *
 * The composed convenience component: owns a `VibecodingSession` (via `useVibecodingSession`) and
 * wires it into `PartsViewer` (the file viewer) and `DocumentPreview` (the renderer) plus an
 * undo/redo toolbar, the same "headless hook + presentational pieces + one drop-in pane" shape
 * `@jini-ai/chat/react`'s `<ChatPane>` uses over its own headless primitives. A host that wants a
 * different layout composes `PartsViewer`/`DocumentPreview`/`useVibecodingSession` directly instead
 * — this component does not own anything those three don't already expose.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import type { PartId } from '../../core/types.js';
import type { VibecodingSession } from '../session.js';
import { useVibecodingSession } from '../use-vibecoding-session.js';
import { PartsViewer } from './PartsViewer.js';
import { DocumentPreview } from './DocumentPreview.js';

export interface VibecodingWorkbenchProps {
  readonly session: VibecodingSession;
  /**
   * Host-supplied whole-document HTML for the preview pane. Omitted, the preview instead shows the
   * SELECTED part's own content — see `./DocumentPreview.js`'s doc for why a generic `EditTarget`
   * has no "whole document" verb this component could read on its own. A host built on the
   * `html` region target (`../../html/regions.ts`) already holds the composed document as its own
   * `HtmlDocumentStore` state and is the natural place to supply this.
   */
  readonly documentHtml?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
}

const ROOT_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  border: '1px solid #e2e5ea',
  borderRadius: 8,
  overflow: 'hidden',
  background: '#fff',
};

const TOOLBAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  borderBottom: '1px solid #e2e5ea',
  fontSize: 12,
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  color: '#374151',
};

const BUTTON_STYLE: CSSProperties = {
  font: 'inherit',
  border: '1px solid #d0d5dd',
  background: '#fff',
  borderRadius: 6,
  padding: '3px 10px',
  cursor: 'pointer',
};

const BUTTON_DISABLED_STYLE: CSSProperties = { ...BUTTON_STYLE, opacity: 0.5, cursor: 'default' };

const ERROR_STYLE: CSSProperties = { color: '#b42318', marginLeft: 'auto' };

const BODY_STYLE: CSSProperties = { display: 'flex', flex: 1, minHeight: 0 };
const PANE_STYLE: CSSProperties = { flex: 1, minWidth: 0, minHeight: 0, borderRight: '1px solid #e2e5ea' };
const PREVIEW_PANE_STYLE: CSSProperties = { flex: 1, minWidth: 0, minHeight: 0 };

/**
 * A ready-to-drop-in pane combining the file viewer, the live renderer, and undo/redo controls
 * over one `session`.
 *
 * Selection is local UI state, not part of `VibecodingSession` — a session describes the artifact,
 * not which part a particular viewer happens to have open, and a host rendering two workbenches
 * over the same session (unlikely today, but not precluded) should not have them fight over one
 * shared selection.
 *
 * @complexity O(parts.length) to render the viewer; content fetches are cached — see `../session.js`.
 */
export function VibecodingWorkbench({ session, documentHtml, className, style }: VibecodingWorkbenchProps) {
  const { parts, partContent, canUndo, canRedo, lastError, readPart, undo, redo } = useVibecodingSession({ session });
  const [selectedId, setSelectedId] = useState<PartId | null>(null);
  const [selectedContent, setSelectedContent] = useState<string | undefined>(undefined);
  const [contentLoading, setContentLoading] = useState(false);

  // Re-fetches on part-list or cache changes so a chat-driven edit or history replay to
  // the currently open part shows up immediately: `readPart` resolves from `session`'s cache
  // (already updated by `applyEdits`/`undo`/`redo` themselves — see `../session.js`), so this is a
  // cache hit, not a host round trip, whenever the edit is what triggered the re-render.
  useEffect(() => {
    if (selectedId === null) {
      setSelectedContent(undefined);
      return;
    }
    let cancelled = false;
    setContentLoading(true);
    readPart({ id: selectedId })
      .then((content) => {
        if (!cancelled) setSelectedContent(content);
      })
      .catch(() => {
        // `lastError` on the session snapshot already surfaces this — see `useVibecodingSession`'s
        // own doc for why a rejection here is not rethrown into an unhandled effect error.
      })
      .finally(() => {
        if (!cancelled) setContentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, readPart, parts, partContent]);

  const previewHtml = documentHtml ?? selectedContent ?? '';

  return (
    <div className={className} style={style ? { ...ROOT_STYLE, ...style } : ROOT_STYLE}>
      <div style={TOOLBAR_STYLE}>
        <button type="button" style={canUndo ? BUTTON_STYLE : BUTTON_DISABLED_STYLE} disabled={!canUndo} onClick={() => void undo()}>
          Undo
        </button>
        <button type="button" style={canRedo ? BUTTON_STYLE : BUTTON_DISABLED_STYLE} disabled={!canRedo} onClick={() => void redo()}>
          Redo
        </button>
        {lastError ? <span style={ERROR_STYLE}>{lastError}</span> : null}
      </div>
      <div style={BODY_STYLE}>
        <div style={PANE_STYLE}>
          <PartsViewer
            parts={parts}
            selectedId={selectedId}
            onSelect={setSelectedId}
            // Conditionally spread rather than `content={selectedContent}`: this workspace's
            // `exactOptionalPropertyTypes` treats an explicit `undefined` value as distinct from an
            // omitted key, and `PartsViewerProps.content` means the latter. Mirrors the same
            // conditional-spread pattern `@jini-ai/ui`'s `features/connectors/rules.ts` uses for
            // identical reasons.
            {...(selectedContent !== undefined ? { content: selectedContent } : {})}
            contentLoading={contentLoading}
            style={{ height: '100%' }}
          />
        </div>
        <div style={PREVIEW_PANE_STYLE}>
          <DocumentPreview html={previewHtml} />
        </div>
      </div>
    </div>
  );
}
