// Dumb panel for the saved-memory records: counts, the type-filter pills, the
// extraction clear/refresh toolbar, and the unified list (saved entries + the
// visible extraction rows). Rendering only — every list, count, and handler is
// supplied by a host's entries/extractions hooks.
import { useMemo, type MutableRefObject } from 'react';
import { Icon } from '../../../../react/components/Icon.js';
import { useT } from '../../../i18n/index.js';
import { TYPES } from '../../constants.js';
import { memoryTypeLabels } from '../../formatters.js';
import type { MemoryEntrySummary, MemoryExtractionRecord, MemoryType } from '../../types.js';
import { MemoryEntryCard } from './MemoryEntryCard.js';
import { MemoryExtractionCard } from './MemoryExtractionCard.js';

export function MemoryList({
  sectionRef,
  entries,
  filtered,
  visibleExtractions,
  filter,
  onFilterChange,
  unifiedMemoryCount,
  onClearExtractions,
  onRefreshExtractions,
  isRefreshing,
  previewId,
  previewBody,
  nowClock,
  onOpenPreview,
  onStartEdit,
  onDeleteEntry,
  onDeleteExtraction,
}: {
  sectionRef: MutableRefObject<HTMLElement | null>;
  entries: MemoryEntrySummary[];
  filtered: MemoryEntrySummary[];
  visibleExtractions: MemoryExtractionRecord[];
  filter: 'all' | MemoryType;
  onFilterChange: (filter: 'all' | MemoryType) => void;
  unifiedMemoryCount: number;
  onClearExtractions: () => void;
  onRefreshExtractions: () => void;
  isRefreshing: boolean;
  previewId: string | null;
  previewBody: string | null;
  nowClock: number;
  onOpenPreview: (id: string) => void;
  onStartEdit: (id: string) => void;
  onDeleteEntry: (id: string) => void;
  onDeleteExtraction: (id: string) => void;
}) {
  const t = useT();
  const typeLabel = useMemo(() => memoryTypeLabels(t), [t]);
  return (
    <section ref={sectionRef} className="settings-section settings-section-card memory-records-section">
      <div className="memory-management-panel">
        <div className="memory-subsection-head">
          <div>
            <h4>{t('Saved memory')}</h4>
            <p className="hint">{t('Saved facts, preferences, and project context available to future chats.')}</p>
          </div>
          <div className="memory-management-counts">
            <span className="memory-source-badge">{entries.length} {t('saved')}</span>
            {visibleExtractions.length > 0 ? (
              <span className="memory-source-badge">
                {visibleExtractions.length} {visibleExtractions.length === 1 ? t('extraction') : t('extractions')}
              </span>
            ) : null}
          </div>
        </div>

        <div className="library-toolbar is-row">
          <div className="library-filters">
            <button type="button" className={`filter-pill${filter === 'all' ? ' active' : ''}`} onClick={() => onFilterChange('all')}>
              {t('All')}
              <span className="filter-pill-count">{entries.length + visibleExtractions.length}</span>
            </button>
            {TYPES.map((type) => {
              const count = entries.filter((e) => e.type === type).length;
              if (count === 0 && filter !== type) return null;
              return (
                <button
                  key={type}
                  type="button"
                  className={`filter-pill${filter === type ? ' active' : ''}`}
                  onClick={() => onFilterChange(type)}
                >
                  {typeLabel[type]}
                  <span className="filter-pill-count">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="memory-management-actions">
            {visibleExtractions.length > 0 ? (
              <button
                type="button"
                className="ghost memory-clear-extractions"
                onClick={() => onClearExtractions()}
                title={t('Clear extraction history')}
              >
                <Icon name="close" size={12} />
                <span>{t('Clear')}</span>
              </button>
            ) : null}
            {visibleExtractions.length > 0 ? (
              <button
                type="button"
                className="ghost memory-refresh-extractions"
                onClick={() => onRefreshExtractions()}
                disabled={isRefreshing}
                title={t('Refresh')}
              >
                <Icon name="refresh" size={12} className={isRefreshing ? 'icon-spin' : ''} />
                <span>{isRefreshing ? t('Refreshing') : t('Refresh')}</span>
              </button>
            ) : null}
          </div>
        </div>

        <div className="library-content memory-unified-list">
          {unifiedMemoryCount === 0 ? (
            // Empty state: one clear "no rows yet" line and a one-sentence
            // primer that explains the mechanism (talk in chat, fact gets
            // extracted) with a single example.
            <div className="library-empty">
              <p className="library-empty-title">{t('No saved memories yet')}</p>
              <p className="library-empty-hint">
                {t('Tell the assistant a fact in chat — e.g.')} <code>{t('I prefer dark mode')}</code>{' '}
                {t('— and it will be saved here automatically.')}
              </p>
            </div>
          ) : (
            <>
              {filtered.map((entry) => (
                <MemoryEntryCard
                  key={entry.id}
                  entry={entry}
                  previewId={previewId}
                  previewBody={previewBody}
                  onOpenPreview={onOpenPreview}
                  onStartEdit={onStartEdit}
                  onDelete={onDeleteEntry}
                />
              ))}
              {visibleExtractions.map((record) => (
                <MemoryExtractionCard key={record.id} record={record} nowClock={nowClock} onOpenPreview={onOpenPreview} onDelete={onDeleteExtraction} />
              ))}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
