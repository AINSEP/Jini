// Dumb panel for the saved-memory records: counts, the type-filter pills, the
// extraction clear/refresh toolbar, and the unified list (saved entries + the
// visible extraction rows). Rendering only — every list, count, and handler is
// supplied by a host's entries/extractions hooks.
import { useMemo, type MutableRefObject } from 'react';
import {
  agentHandleProps,
  agentSubHandle,
  buildAgentListHandles,
} from '@jini-ai/core/agent-handles';
import { Icon } from '../../../../react/components/Icon.js';
import { useT } from '../../../i18n/index.js';
import { TYPES } from '../../constants.js';
import { memoryTypeLabels } from '../../formatters.js';
import type { MemoryEntrySummary, MemoryExtractionRecord, MemoryType } from '../../types.js';
import { MemoryEntryCard } from './MemoryEntryCard.js';
import { MemoryExtractionCard } from './MemoryExtractionCard.js';

type MemoryFilter = 'all' | MemoryType;

/** Per-row agent handles under `<agentHandle>-<action>`, or undefined when unpublished. */
function rowHandles({ agentHandle, action, ids }: { agentHandle: string | undefined; action: string; ids: string[] }): string[] | undefined {
  return agentHandle ? buildAgentListHandles({ prefix: agentSubHandle({ base: agentHandle, action }), ids }) : undefined;
}

function MemoryListCounts({ savedCount, extractionCount, useTHook = useT }: { savedCount: number; extractionCount: number; useTHook?: typeof useT; }) {
  const t = useTHook();
  return (
    <div className="jini-memory-management-counts">
      <span className="jini-ui-memory-source-badge">{savedCount} {t('saved')}</span>
      {extractionCount > 0 ? (
        <span className="jini-ui-memory-source-badge">
          {extractionCount} {extractionCount === 1 ? t('extraction') : t('extractions')}
        </span>
      ) : null}
    </div>
  );
}

function MemoryFilterPills({
  entries,
  extractionCount,
  filter,
  onFilterChange,
  agentHandle,
  useTHook = useT,
}: {
  entries: MemoryEntrySummary[];
  extractionCount: number;
  filter: MemoryFilter;
  onFilterChange: (filter: MemoryFilter) => void;
  agentHandle: string | undefined;
  useTHook?: typeof useT;
}) {
  const t = useTHook();
  const typeLabel = useMemo(() => memoryTypeLabels({ t }), [t]);
  return (
    <div className="jini-library-filters">
      <button
        type="button"
        className={`filter-pill${filter === 'all' ? ' active' : ''}`}
        onClick={() => onFilterChange('all')}
        {...agentHandleProps({}, { base: agentHandle, action: 'filter-all', role: 'button', label: t('All') })}
      >
        {t('All')}
        <span className="jini-filter-pill-count">{entries.length + extractionCount}</span>
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
            {...agentHandleProps({}, { base: agentHandle, action: `filter-${type}`, role: 'button', label: typeLabel[type] })}
          >
            {typeLabel[type]}
            <span className="jini-filter-pill-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

function MemoryExtractionActions({
  onClearExtractions,
  onRefreshExtractions,
  isRefreshing,
  agentHandle,
  useTHook = useT,
}: {
  onClearExtractions: () => void;
  onRefreshExtractions: () => void;
  isRefreshing: boolean;
  agentHandle: string | undefined;
  useTHook?: typeof useT;
}) {
  const t = useTHook();
  return (
    <>
      <button
        type="button"
        className="ghost jini-memory-clear-extractions"
        onClick={() => onClearExtractions()}
        title={t('Clear extraction history')}
        {...agentHandleProps({}, { base: agentHandle, action: 'clear-extractions', role: 'button', label: t('Clear extraction history') })}
      >
        <Icon name="close" size={12} />
        <span>{t('Clear')}</span>
      </button>
      <button
        type="button"
        className="ghost jini-memory-refresh-extractions"
        onClick={() => onRefreshExtractions()}
        disabled={isRefreshing}
        title={t('Refresh')}
        {...agentHandleProps({}, { base: agentHandle, action: 'refresh-extractions', role: 'button', label: t('Refresh') })}
      >
        <Icon name="refresh" size={12} className={isRefreshing ? 'icon-spin' : ''} />
        <span>{isRefreshing ? t('Refreshing') : t('Refresh')}</span>
      </button>
    </>
  );
}

function MemoryListEmpty({ useTHook = useT }: { useTHook?: typeof useT } = {}) {
  const t = useTHook();
  return (
    // Empty state: one clear "no rows yet" line and a one-sentence
    // primer that explains the mechanism (talk in chat, fact gets
    // extracted) with a single example.
    <div className="jini-library-empty">
      <p className="jini-library-empty-title">{t('No saved memories yet')}</p>
      <p className="jini-library-empty-hint">
        {t('Tell the assistant a fact in chat — e.g.')} <code>{t('I prefer dark mode')}</code>{' '}
        {t('— and it will be saved here automatically.')}
      </p>
    </div>
  );
}

function MemoryListRows({
  filtered,
  visibleExtractions,
  previewId,
  previewBody,
  nowClock,
  onOpenPreview,
  onStartEdit,
  onDeleteEntry,
  onDeleteExtraction,
  agentHandle,
}: {
  filtered: MemoryEntrySummary[];
  visibleExtractions: MemoryExtractionRecord[];
  previewId: string | null;
  previewBody: string | null;
  nowClock: number;
  onOpenPreview: (id: string) => void;
  onStartEdit: (id: string) => void;
  onDeleteEntry: (id: string) => void;
  onDeleteExtraction: (id: string) => void;
  agentHandle: string | undefined;
}) {
  const entryHandles = rowHandles({ agentHandle, action: 'entry', ids: filtered.map((e) => e.id) });
  const extractionHandles = rowHandles({ agentHandle, action: 'extraction', ids: visibleExtractions.map((r) => r.id) });
  return (
    <>
      {filtered.map((entry, index) => (
        <MemoryEntryCard
          key={entry.id}
          entry={entry}
          previewId={previewId}
          previewBody={previewBody}
          onOpenPreview={onOpenPreview}
          onStartEdit={onStartEdit}
          onDelete={onDeleteEntry}
          {...(entryHandles?.[index] ? { agentHandle: entryHandles[index] } : {})}
        />
      ))}
      {visibleExtractions.map((record, index) => (
        <MemoryExtractionCard
          key={record.id}
          record={record}
          nowClock={nowClock}
          onOpenPreview={onOpenPreview}
          onDelete={onDeleteExtraction}
          {...(extractionHandles?.[index] ? { agentHandle: extractionHandles[index] } : {})}
        />
      ))}
    </>
  );
}

/** Filter pills plus, while extractions are listed, their clear / refresh actions. */
function MemoryListToolbar({ entries, extractionCount, filter, onFilterChange, onClearExtractions, onRefreshExtractions, isRefreshing, agentHandle }: {
  entries: MemoryEntrySummary[];
  extractionCount: number;
  filter: 'all' | MemoryType;
  onFilterChange: (filter: 'all' | MemoryType) => void;
  onClearExtractions: () => void;
  onRefreshExtractions: () => void;
  isRefreshing: boolean;
  agentHandle: string | undefined;
}) {
  return (
  <div className="jini-library-toolbar jini-is-row">
    <MemoryFilterPills
      entries={entries}
      extractionCount={extractionCount}
      filter={filter}
      onFilterChange={onFilterChange}
      agentHandle={agentHandle}
    />
    <div className="jini-memory-management-actions">
      {extractionCount > 0 ? (
        <MemoryExtractionActions
          onClearExtractions={onClearExtractions}
          onRefreshExtractions={onRefreshExtractions}
          isRefreshing={isRefreshing}
          agentHandle={agentHandle}
        />
      ) : null}
    </div>
  </div>
  );
}

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
  agentHandle,
  useTHook = useT,
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
  /** This section's own agent handle — see `MemorySettingsPanel`'s `agentHandle` doc. */
  agentHandle?: string;
  useTHook?: typeof useT;
}) {
  const t = useTHook();
  return (
    <section ref={sectionRef} className="settings-section jini-ui-settings-section-card jini-ui-memory-records-section">
      <div className="jini-ui-memory-management-panel">
        <div className="jini-ui-memory-subsection-head">
          <div>
            <h4>{t('Saved memory')}</h4>
            <p className="hint">{t('Saved facts, preferences, and project context available to future chats.')}</p>
          </div>
          <MemoryListCounts savedCount={entries.length} extractionCount={visibleExtractions.length} />
        </div>

        <MemoryListToolbar
          entries={entries}
          extractionCount={visibleExtractions.length}
          filter={filter}
          onFilterChange={onFilterChange}
          onClearExtractions={onClearExtractions}
          onRefreshExtractions={onRefreshExtractions}
          isRefreshing={isRefreshing}
          agentHandle={agentHandle}
        />

        <div className="jini-ui-library-content memory-unified-list">
          {unifiedMemoryCount === 0 ? (
            <MemoryListEmpty />
          ) : (
            <MemoryListRows
              filtered={filtered}
              visibleExtractions={visibleExtractions}
              previewId={previewId}
              previewBody={previewBody}
              nowClock={nowClock}
              onOpenPreview={onOpenPreview}
              onStartEdit={onStartEdit}
              onDeleteEntry={onDeleteEntry}
              onDeleteExtraction={onDeleteExtraction}
              agentHandle={agentHandle}
            />
          )}
        </div>
      </div>
    </section>
  );
}
