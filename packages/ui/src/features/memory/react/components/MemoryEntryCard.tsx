// Dumb card for one saved memory entry: title, description, the preview toggle,
// and edit/delete actions. Preview open/close state and the transport live in
// a host's entries hook; this renders what it is given. `renderMarkdown` is a
// scoped-down local reimplementation of OD's `runtime/markdown.tsx` (2,881
// lines, chat/artifact-rendering territory, explicitly deferred to
// `@jini-ai/chat-react`/`@jini-ai/renderers-react` — see `packages/ui/source-map.md`)
// — just enough to render a saved memory's plain-text/Markdown body safely.
import { Icon } from '../../../../react/components/Icon.js';
import { useT } from '../../../i18n/index.js';
import { renderMarkdown } from '../render-markdown.js';
import type { MemoryEntrySummary } from '../../types.js';

export function MemoryEntryCard({
  entry,
  previewId,
  previewBody,
  onOpenPreview,
  onStartEdit,
  onDelete,
}: {
  entry: MemoryEntrySummary;
  previewId: string | null;
  previewBody: string | null;
  onOpenPreview: (id: string) => void;
  onStartEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const t = useT();
  return (
    <div className="library-card">
      <div className="library-card-info">
        <div className="library-card-title-row">
          <span className="library-card-name">{entry.name}</span>
        </div>
        <div className="library-card-desc">{entry.description || '—'}</div>
      </div>
      <div className="memory-card-actions">
        <button
          type="button"
          className="library-card-expand"
          onClick={() => onOpenPreview(entry.id)}
          title={t('Preview')}
        >
          <Icon name={previewId === entry.id ? 'chevron-down' : 'chevron-right'} size={14} />
        </button>
        <button type="button" className="ghost library-card-action" onClick={() => onStartEdit(entry.id)} title={t('Edit')}>
          <Icon name="edit" size={14} />
        </button>
        <button type="button" className="ghost library-card-action" onClick={() => onDelete(entry.id)} title={t('Delete')}>
          <Icon name="close" size={14} />
        </button>
      </div>
      {previewId === entry.id && (
        <div className="library-preview" style={{ width: '100%' }}>
          {previewBody === null ? (
            <p>{t('Loading…')}</p>
          ) : previewBody ? (
            <div className="library-preview-body">{renderMarkdown(previewBody)}</div>
          ) : (
            <p className="hint">—</p>
          )}
        </div>
      )}
    </div>
  );
}
