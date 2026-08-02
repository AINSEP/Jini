// Dumb panel for the "Add manually" source tab: the summary + New button, the
// transient flash pill, and the create/edit form (starters, name/type/desc/body,
// save/cancel). The draft, its validity, and the save transport live in a
// host's entries hook; this renders the draft and reports edits.
import { useMemo, type MutableRefObject } from 'react';
import { Icon } from '../../../../react/components/Icon.js';
import { useT } from '../../../i18n/index.js';
import { STARTERS, TYPES } from '../../constants.js';
import { memoryFlashLabels, memoryTypeLabels } from '../../formatters.js';
import type { DraftEntry, FlashKind, MemoryType } from '../../types.js';
import { FIELD_LABEL_STYLE } from '../styles.js';

export function MemoryManualEditor({
  editing,
  onEditingChange,
  onStartNew,
  onCancel,
  onSave,
  busy,
  editorRef,
  editorNameRef,
  flash,
}: {
  editing: DraftEntry | null;
  onEditingChange: (draft: DraftEntry) => void;
  onStartNew: () => void;
  onCancel: () => void;
  onSave: () => void;
  busy: boolean;
  editorRef: MutableRefObject<HTMLDivElement | null>;
  editorNameRef: MutableRefObject<HTMLInputElement | null>;
  flash: { kind: FlashKind; key: number } | null;
}) {
  const t = useT();
  const typeLabel = useMemo(() => memoryTypeLabels(t), [t]);
  const flashLabel = useMemo(() => memoryFlashLabels(t), [t]);
  return (
    <div className="memory-tab-panel memory-manual-panel">
      <div className="memory-source-summary">
        <span className="memory-block-icon">
          <Icon name="edit" size={15} />
        </span>
        <div>
          <h4>{t('Add manually')}</h4>
          <p className="hint">
            {t('Add facts, preferences, or project context yourself. Fixed assistant behavior lives in Instructions / Rules.')}
          </p>
        </div>
        <button type="button" className="primary memory-source-action" onClick={onStartNew} disabled={editing !== null}>
          <Icon name="plus" size={14} />
          <span>{t('New')}</span>
        </button>
      </div>

      {flash && flash.kind !== 'pathCopied' ? (
        <div key={flash.key} role="status" aria-live="polite" className="memory-flash-pill">
          {flashLabel[flash.kind]}
        </div>
      ) : null}

      {editing ? (
        <div
          ref={editorRef}
          className="library-card"
          style={{
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: 14,
            padding: 14,
            background: 'var(--surface-subtle, rgba(0,0,0,0.02))',
            border: '1px solid var(--border-subtle, rgba(0,0,0,0.08))',
            borderRadius: 10,
          }}
        >
          {!editing.id ? (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 6,
                paddingBottom: 10,
                borderBottom: '1px solid var(--border-subtle, rgba(0,0,0,0.06))',
              }}
            >
              <span
                style={{
                  ...FIELD_LABEL_STYLE,
                  display: 'inline-block',
                  marginRight: 4,
                  marginBottom: 0,
                }}
              >
                {t('Start from')}
              </span>
              {STARTERS.map((starter) => (
                <button
                  key={starter.name}
                  type="button"
                  className="filter-pill"
                  onClick={() =>
                    onEditingChange({
                      id: editing.id,
                      type: starter.type,
                      name: t(starter.name),
                      description: t(starter.description),
                      body: t(starter.body),
                    })
                  }
                  title={t(starter.description)}
                  style={{ display: 'inline-flex', alignItems: 'center' }}
                >
                  {t(starter.name)}
                </button>
              ))}
            </div>
          ) : null}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              width: '100%',
            }}
          >
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label style={FIELD_LABEL_STYLE}>{t('Name')}</label>
                <input
                  ref={editorNameRef}
                  type="text"
                  placeholder={t('e.g. Prefers dark mode')}
                  value={editing.name}
                  onChange={(e) => onEditingChange({ ...editing, name: e.target.value })}
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ flex: '0 0 auto', minWidth: 120 }}>
                <label style={FIELD_LABEL_STYLE}>{t('Type')}</label>
                <select
                  value={editing.type}
                  onChange={(e) => onEditingChange({ ...editing, type: e.target.value as MemoryType })}
                  style={{ width: '100%' }}
                >
                  {TYPES.map((tt) => (
                    <option key={tt} value={tt}>
                      {typeLabel[tt]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label style={FIELD_LABEL_STYLE}>{t('Description')}</label>
              <input
                type="text"
                placeholder={t('Short description')}
                value={editing.description}
                onChange={(e) => onEditingChange({ ...editing, description: e.target.value })}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={FIELD_LABEL_STYLE}>{t('Details')}</label>
              <textarea
                placeholder={t('What should the assistant remember?')}
                value={editing.body}
                onChange={(e) => onEditingChange({ ...editing, body: e.target.value })}
                rows={7}
                style={{
                  width: '100%',
                  fontFamily: 'monospace',
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              />
              <p className="hint" style={{ fontSize: 11, marginTop: 4 }}>
                {t('Plain text or Markdown. Keep it concise — this is added to future chat context.')}
              </p>
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
            }}
          >
            <span
              className="hint"
              style={{
                fontSize: 11,
                margin: 0,
                color: 'var(--text-muted, #888)',
              }}
            >
              {t('Saved memories are available to future chats.')}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="ghost" onClick={onCancel}>
                {t('Cancel')}
              </button>
              <button type="button" className="primary" onClick={onSave} disabled={busy || !editing.name.trim()}>
                {editing.id ? t('Save') : t('Create')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
