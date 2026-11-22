// Dumb "Advanced" modal: the raw MEMORY.md index editor plus the technical
// memory-tree view. Rendered into `modalHost` via a portal (a host resolves
// `document.body` and passes it, so this file stays DOM-free). All state +
// transport live in the entries hook; this is props-in / JSX-out.
import { createPortal } from 'react-dom';
import { Icon } from '../../../../react/components/Icon.js';
import { useT } from '../../../i18n/index.js';
import type { MemoryTreeNode } from '../../types.js';

type MemoryIndexEditorCardProps = Pick<
  MemoryAdvancedModalProps,
  'index' | 'indexDraft' | 'onIndexDraftChange' | 'onSaveIndex' | 'busy'
>;

function MemoryIndexEditorFooter({
  indexDraft,
  onIndexDraftChange,
  onSaveIndex,
  busy,
  useTHook = useT,
}: Omit<MemoryIndexEditorCardProps, 'index'> & { useTHook?: typeof useT }) {
  const t = useTHook();
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 6,
        flexWrap: 'wrap',
      }}
    >
      <span
        className="hint"
        style={{
          fontSize: 11,
          margin: 0,
          color: indexDraft !== null ? 'var(--jini-warning)' : 'var(--jini-text-muted)',
          fontWeight: indexDraft !== null ? 600 : 400,
        }}
      >
        {indexDraft !== null
          ? `● ${t('Unsaved changes')} — ${t('Edits here change how memories are indexed.')}`
          : t('Edits here change how memories are indexed.')}
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="ghost" onClick={() => onIndexDraftChange(null)} disabled={indexDraft === null}>
          {t('Reset')}
        </button>
        <button type="button" className="primary" onClick={onSaveIndex} disabled={busy || indexDraft === null}>
          {t('Save index')}
        </button>
      </div>
    </div>
  );
}

function MemoryIndexEditorCard({ index, indexDraft, onIndexDraftChange, onSaveIndex, busy, useTHook = useT }: MemoryIndexEditorCardProps & { useTHook?: typeof useT }) {
  const t = useTHook();
  return (
    <details className="jini-library-group jini-memory-advanced-card">
      <summary className="jini-memory-details-summary">
        <span className="jini-memory-details-title">{t('MEMORY.md index')}</span>
      </summary>
      <textarea
        value={indexDraft ?? index}
        onChange={(e) => onIndexDraftChange(e.target.value)}
        rows={8}
        style={{
          width: '100%',
          marginTop: 8,
          fontFamily: 'var(--jini-font-mono)',
        }}
      />
      <MemoryIndexEditorFooter indexDraft={indexDraft} onIndexDraftChange={onIndexDraftChange} onSaveIndex={onSaveIndex} busy={busy} />
    </details>
  );
}

type MemoryTreeCardProps = Pick<
  MemoryAdvancedModalProps,
  'memoryTree' | 'treeFolders' | 'treeChildren' | 'onStartEdit'
>;

function MemoryTreeCard({ memoryTree, treeFolders, treeChildren, onStartEdit, useTHook = useT }: MemoryTreeCardProps & { useTHook?: typeof useT }) {
  const t = useTHook();
  if (treeFolders.length === 0) return null;
  return (
    <details className="jini-library-group jini-memory-advanced-card">
      <summary className="jini-memory-details-summary">
        <span className="jini-memory-details-title">{t('Memory tree')}</span>
        <span className="jini-filter-pill-count">{memoryTree.length}</span>
      </summary>
      <p className="jini-memory-advanced-hint">
        {t('Technical view of the same saved memories. Most users only need the saved-memory list above.')}
      </p>
      <div className="jini-memory-tree-advanced">
        {treeFolders.map((folder) => (
          <MemoryTreeFolderCard
            key={folder.id}
            folder={folder}
            childNodes={treeChildren.get(folder.id) ?? []}
            onStartEdit={onStartEdit}
          />
        ))}
      </div>
    </details>  );
}

function MemoryTreeFolderCard({
  folder,
  childNodes,
  onStartEdit,
  useTHook = useT,
}: {
  folder: MemoryTreeNode;
  childNodes: MemoryTreeNode[];
  onStartEdit: (id: string) => void;
  useTHook?: typeof useT;
}) {
  const t = useTHook();
  return (
          <div className="library-card" style={{ alignItems: 'stretch' }}>
            <div className="library-card-info" style={{ width: '100%' }}>
              <div className="library-card-title-row">
                <span className="library-card-name">{folder.name}</span>
                <span className="library-card-badge">{folder.path}</span>
              </div>
              <div className="library-card-desc">
                {childNodes.length} {childNodes.length === 1 ? t('node') : t('nodes')}
              </div>
              {childNodes.length > 0 ? (
                <ul
                  style={{
                    display: 'grid',
                    gap: 6,
                    margin: '8px 0 0',
                    padding: 0,
                    listStyle: 'none',
                  }}
                >
                  {childNodes.map((child) => (
                    <MemoryTreeChildRow key={child.id} child={child} onStartEdit={onStartEdit} />
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
  );
}

function MemoryTreeChildRow({ child, onStartEdit, useTHook = useT }: { child: MemoryTreeNode; onStartEdit: (id: string) => void; useTHook?: typeof useT; }) {
  const t = useTHook();
  return (
    <li className="jini-memory-tree-child-row">
      <span style={{ minWidth: 0 }}>
        <span className="library-card-name">{child.name}</span>{' '}
        <span className="library-card-badge">{child.id}</span>
        {child.description ? (
          <span className="library-card-desc" style={{ display: 'block' }}>
            {child.description}
          </span>
        ) : null}
      </span>
      <div className="memory-card-actions">
        <button
          type="button"
          className="ghost library-card-action"
          onClick={() => onStartEdit(child.id)}
          title={t('Edit')}
        >
          <Icon name="edit" size={14} />
        </button>
      </div>
    </li>
  );
}

export interface MemoryAdvancedModalProps {
  open: boolean;
  modalHost: HTMLElement | null;
  onClose: () => void;
  index: string;
  indexDraft: string | null;
  onIndexDraftChange: (value: string | null) => void;
  onSaveIndex: () => void;
  busy: boolean;
  memoryTree: MemoryTreeNode[];
  treeFolders: MemoryTreeNode[];
  treeChildren: Map<string, MemoryTreeNode[]>;
  onStartEdit: (id: string) => void;
  useTHook?: typeof useT;
}

export function MemoryAdvancedModal({ useTHook = useT, ...props }: MemoryAdvancedModalProps) {
  const { open, modalHost, onClose } = props;
  const t = useTHook();
  if (!open || !modalHost) return null;
  return createPortal(
    <div
      className="jini-memory-action-modal-backdrop"
      role="presentation"
      // The dialog below stops propagation, so any mouse-down that reaches the
      // backdrop must have originated on the backdrop itself.
      onMouseDown={onClose}
    >
      <div
        className="jini-memory-action-modal jini-memory-action-modal--advanced"
        role="dialog"
        aria-modal="true"
        aria-labelledby="memory-advanced-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="jini-memory-action-modal-head">
          <div>
            <h3 id="memory-advanced-modal-title">{t('Advanced')}</h3>
            <p>{t('Inspect or edit the underlying memory index.')}</p>
          </div>
          <button type="button" className="jini-memory-action-modal-close" onClick={onClose} aria-label={t('Close')} title={t('Close')}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="jini-memory-action-modal-body jini-memory-advanced-modal-body">
          <p className="jini-memory-advanced-hint">{t('Inspect or edit the underlying memory index.')}</p>
          <div className="jini-memory-advanced-stack">
            <MemoryIndexEditorCard {...props} />
            <MemoryTreeCard {...props} />
          </div>
        </div>
      </div>
    </div>,
    modalHost,
  );
}
