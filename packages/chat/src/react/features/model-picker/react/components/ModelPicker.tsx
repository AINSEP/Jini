/**
 * @module ModelPicker
 *
 * A generic, provider-grouped, credential-status-badged, searchable model
 * picker: trigger button + inline popover. Consolidates two independently
 * re-implemented OD shapes that R6 confirmed share this exact pattern —
 * `NewProjectPanel.tsx`'s `MediaModelCards` (provider grouping + status
 * badges + search) and `modelOptions.tsx`'s `SearchableModelSelect`
 * (searchable trigger/popover with outside-click/Escape dismissal, folded
 * into `useModelPicker`). Unlike `SearchableModelSelect`, the popover
 * renders inline rather than via a `document.body` portal — this package
 * has no fixed-positioning collision-avoidance primitive of its own, and an
 * inline popover keeps the component trivially testable; a host embedding
 * this inside a clipping/overflow container can override positioning with
 * its own CSS. See `source-map.md`.
 */
import { useT } from '../../../../hooks/context.js';
import { Icon } from '../../../../components/Icon.js';
import { modelSubtitle } from '../../rules.js';
import { useModelPicker } from '../hooks/useModelPicker.hooks.js';
import type { UseModelPickerOptions } from '../hooks/useModelPicker.hooks.js';
import { CredentialStatusBadge } from './CredentialStatusBadge.js';

export interface ModelPickerProps extends UseModelPickerOptions {
  label: string;
  searchPlaceholder?: string;
  className?: string;
  'data-testid'?: string;
}

export function ModelPicker({
  label,
  searchPlaceholder,
  className,
  'data-testid': testId,
  ...pickerOptions
}: ModelPickerProps) {
  const t = useT();
  const { open, query, filteredGroups, selection, shouldShowSearch, containerRef, setQuery, toggle, select } =
    useModelPicker(pickerOptions);

  const triggerTitle = selection?.model.label ?? t('No model selected');
  const triggerSubtitle = selection ? modelSubtitle(selection) : t('Choose a model');
  const totalMatches = filteredGroups.reduce((count, group) => count + group.models.length, 0);

  return (
    <div className={`model-picker${className ? ` ${className}` : ''}`} ref={containerRef} data-testid={testId}>
      <span className="model-picker-label">{t(label)}</span>
      <button
        type="button"
        className={`model-picker-trigger${open ? ' is-open' : ''}${selection ? '' : ' is-empty'}`}
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={testId ? `${testId}-trigger` : undefined}
      >
        <span className="model-picker-trigger-meta">
          <span className="model-picker-trigger-title">{triggerTitle}</span>
          <span className="model-picker-trigger-subtitle">{triggerSubtitle}</span>
        </span>
        <Icon name="chevron-down" size={14} className="model-picker-trigger-chevron" />
      </button>

      {open ? (
        <div className="model-picker-popover" role="listbox" data-testid={testId ? `${testId}-popover` : undefined}>
          {shouldShowSearch ? (
            <div className="model-picker-search-row">
              <input
                type="search"
                className="model-picker-search"
                value={query}
                placeholder={t(searchPlaceholder ?? 'Search models')}
                aria-label={t(searchPlaceholder ?? 'Search models')}
                data-testid={testId ? `${testId}-search` : undefined}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          ) : null}
          <div className="model-picker-list">
            {totalMatches === 0 ? (
              <div className="model-picker-empty">{t('No matching models')}</div>
            ) : (
              filteredGroups.map((group) => (
                <div className="model-picker-group" key={group.provider.id}>
                  <div className="model-picker-group-head">
                    <span>{t(group.provider.label)}</span>
                    <CredentialStatusBadge status={group.status} />
                  </div>
                  {group.models.map((model) => {
                    const active = selection?.model.id === model.id;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={`model-picker-option${active ? ' is-active' : ''}`}
                        data-testid={testId ? `${testId}-option-${model.id}` : undefined}
                        onClick={() => select(model.id)}
                      >
                        <span className="model-picker-option-title">
                          {model.label}
                          {model.default ? <span className="model-picker-option-badge">{t('Recommended')}</span> : null}
                        </span>
                        {model.hint ? <span className="model-picker-option-hint">{model.hint}</span> : null}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
