// The suggestion review list of the "Import from apps" tab: one selectable card per memory the
// connector scan proposed, plus the save / discard actions. Rendering only.
import { useMemo } from 'react';
import { memoryTypeLabels } from '../../formatters.js';
import type { MemorySuggestion } from '../../types.js';
import { Icon } from '../../../../react/components/Icon.js';
import { useT } from '../../../i18n/index.js';

function MemorySuggestionCard({
  suggestion,
  selected,
  typeLabel,
  toggleConnectorSuggestion,
  useTHook = useT,
}: {
  suggestion: MemorySuggestion;
  selected: boolean;
  typeLabel: string;
  toggleConnectorSuggestion: (suggestionId: string) => void;
  useTHook?: typeof useT;
}) {
  const t = useTHook();
  const sourceLabel = suggestion.source?.connectorName || suggestion.source?.toolTitle || t('Connected apps');
  return (
    <label className={`memory-suggestion-card${selected ? ' is-selected' : ''}`}>
      <span className="memory-connector-check">
        <input type="checkbox" checked={selected} onChange={() => toggleConnectorSuggestion(suggestion.id)} />
        <span aria-hidden="true">{selected ? <Icon name="check" size={13} /> : null}</span>
      </span>
      <span className="memory-suggestion-copy">
        <span className="memory-suggestion-title">
          <strong>{suggestion.name}</strong>
          <span className="memory-type-badge">{typeLabel}</span>
        </span>
        {suggestion.description ? <small>{suggestion.description}</small> : null}
        <span className="memory-suggestion-body">{suggestion.body}</span>
      </span>
      <span className="memory-connector-state is-connected">{sourceLabel}</span>
    </label>
  );
}

export function MemorySuggestionPanel({
  connectorSuggestions,
  selectedSuggestionIds,
  selectedConnectorSuggestions,
  connectorSaving,
  toggleConnectorSuggestion,
  onSaveConnectorSuggestions,
  onDiscardConnectorSuggestions,
  useTHook = useT,
}: {
  connectorSuggestions: MemorySuggestion[];
  selectedSuggestionIds: Set<string>;
  selectedConnectorSuggestions: MemorySuggestion[];
  connectorSaving: boolean;
  toggleConnectorSuggestion: (suggestionId: string) => void;
  onSaveConnectorSuggestions: () => void;
  onDiscardConnectorSuggestions: () => void;
  useTHook?: typeof useT;
}) {
  const t = useTHook();
  const typeLabel = useMemo(() => memoryTypeLabels({ t }), [t]);
  return (
    <div className="memory-suggestion-panel">
      <div className="memory-subsection-head">
        <div>
          <h4>{t('Suggested memories')}</h4>
          <p className="hint">{t('Review design-related memories before saving them.')}</p>
        </div>
        <span className="memory-source-badge">
          {selectedConnectorSuggestions.length} {t('selected')}
        </span>
      </div>
      <div className="memory-suggestion-list">
        {connectorSuggestions.map((suggestion) => (
          <MemorySuggestionCard
            key={suggestion.id}
            suggestion={suggestion}
            selected={selectedSuggestionIds.has(suggestion.id)}
            typeLabel={typeLabel[suggestion.type]}
            toggleConnectorSuggestion={toggleConnectorSuggestion}
          />
        ))}
      </div>
      <div className="memory-connector-actions">
        <button
          type="button"
          className="primary memory-source-action"
          onClick={() => void onSaveConnectorSuggestions()}
          disabled={connectorSaving || selectedConnectorSuggestions.length === 0}
        >
          <Icon name={connectorSaving ? 'refresh' : 'check'} size={14} className={connectorSaving ? 'icon-spin' : ''} />
          <span>{connectorSaving ? t('Saving') : t('Save selected')}</span>
        </button>
        <button type="button" className="ghost memory-source-action" onClick={onDiscardConnectorSuggestions} disabled={connectorSaving}>
          {t('Discard')}
        </button>
      </div>
    </div>
  );
}
