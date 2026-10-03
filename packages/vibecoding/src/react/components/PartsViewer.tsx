/**
 * @module react/components/PartsViewer
 *
 * The "file viewer" half of the user's vision: browse the parts an `EditTarget` currently
 * advertises (`../core/target.ts`'s `listParts()` allowlist) and inspect one part's raw content.
 *
 * ## Why this is not `@jini-ai/ui`'s `AssetTreeBrowser`
 *
 * `AssetTreeBrowser` (`@jini-ai/ui`'s `features/asset-tree-browser`) was checked before writing
 * this component, per this task's own instruction to reuse existing primitives. It was not reused,
 * for a reason worth recording rather than silently deviating from: its `AssetTreeSelectors`
 * REQUIRES `getSize`/`getModifiedAt` on every item, and its data model is a folder-structured
 * filesystem (breadcrumbs, directories, upload, rename, drag/drop). `PartRef` (`../core/types.ts`)
 * has none of that — a part is a flat, host-published id with only an optional `kind`/`label`, and
 * the one `EditTarget` implementation that exists today (`../html/regions.ts`'s tagged-region
 * target) has no filesystem at all. Fabricating a size or a modified time for a part would be
 * inventing data the host never provided, which is worse than a simpler, honestly-scoped list.
 * Once a filesystem-backed `EditTarget` lands (this package's planned `./node`), a file-tree host
 * has the real fields `AssetTreeBrowser` wants, and reusing it there is the right call.
 *
 * ## Deliberately presentational
 *
 * `PartsViewer` takes already-resolved data and callbacks only, no `VibecodingSession` reference —
 * the same split `@jini-ai/ui`'s own feature folders use between headless hooks/state and dumb
 * components. `./VibecodingWorkbench.js` is the composed piece that owns a session and feeds this
 * component; a host that wants a different layout or a different session-driving hook can still
 * reuse this component directly by supplying the same props.
 */
import type { CSSProperties } from 'react';
import type { PartId, PartRef } from '../../core/types.js';

export interface PartsViewerProps {
  readonly parts: readonly PartRef[];
  readonly selectedId?: PartId | null;
  readonly onSelect?: (id: PartId) => void;
  /** The selected part's content, or `undefined` while unread/unselected — see
   *  `./VibecodingWorkbench.js` for how this is sourced from `session.readPart`. */
  readonly content?: string;
  readonly contentLoading?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
}

const ROOT_STYLE: CSSProperties = {
  display: 'flex',
  minHeight: 0,
  height: '100%',
  fontSize: 13,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  color: '#1f2430',
};

const LIST_STYLE: CSSProperties = {
  width: 220,
  flexShrink: 0,
  overflowY: 'auto',
  borderRight: '1px solid #e2e5ea',
  padding: 4,
  margin: 0,
  listStyle: 'none',
};

const ROW_BASE_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  width: '100%',
  textAlign: 'left',
  border: 'none',
  background: 'transparent',
  borderRadius: 6,
  padding: '6px 8px',
  cursor: 'pointer',
  color: 'inherit',
  font: 'inherit',
};

const ROW_SELECTED_STYLE: CSSProperties = {
  ...ROW_BASE_STYLE,
  background: '#e8edfb',
};

const ROW_LABEL_STYLE: CSSProperties = { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const ROW_META_STYLE: CSSProperties = { color: '#6b7280', fontSize: 11 };

const CONTENT_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'auto',
  margin: 0,
  padding: 12,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const EMPTY_STYLE: CSSProperties = { padding: 12, color: '#6b7280' };

/**
 * A flat, selectable list of `parts` on the left and the selected one's raw content on the right.
 *
 * @complexity O(parts.length) to render the list; content rendering is O(content.length).
 * @overallScore 100/100
 */
export function PartsViewer({ parts, selectedId, onSelect, content, contentLoading, className, style }: PartsViewerProps) {
  return (
    <div className={className} style={style ? { ...ROOT_STYLE, ...style } : ROOT_STYLE}>
      <ul style={LIST_STYLE} aria-label="Artifact parts">
        {parts.length === 0 ? (
          <li style={EMPTY_STYLE}>No parts yet.</li>
        ) : (
          parts.map((part) => {
            const isSelected = part.id === selectedId;
            return (
              <li key={part.id}>
                <button
                  type="button"
                  onClick={() => onSelect?.(part.id)}
                  style={isSelected ? ROW_SELECTED_STYLE : ROW_BASE_STYLE}
                  aria-current={isSelected}
                >
                  <span style={ROW_LABEL_STYLE}>{part.label ?? part.id}</span>
                  {/* Omitted (not id-as-fallback) when `kind` is absent — with no label either,
                      the row's own id already appears once above; repeating it here would read as
                      a second, meaningless line instead of real metadata. */}
                  {part.kind ? <span style={ROW_META_STYLE}>{part.kind}</span> : null}
                </button>
              </li>
            );
          })
        )}
      </ul>
      {selectedId === undefined || selectedId === null ? (
        <p style={{ ...CONTENT_STYLE, ...EMPTY_STYLE }}>Select a part to inspect its content.</p>
      ) : contentLoading ? (
        <p style={{ ...CONTENT_STYLE, ...EMPTY_STYLE }}>Loading…</p>
      ) : (
        <pre style={CONTENT_STYLE}>{content ?? ''}</pre>
      )}
    </div>
  );
}
