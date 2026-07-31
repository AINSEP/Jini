import { humanizeSkillCategory } from '@jini-ai/ui-core';
import type { SkillsPort } from '@jini-ai/ui-core';
import { useT } from '../../../../../../features/i18n/index.js';
import { Icon } from '../../../../../../react/components/Icon.js';
import { useSkillsTab } from '../hooks/useSkillsTab.js';
import { SkillDraftForm, type SkillDraftFormLabels } from './SkillDraftForm.js';
import { SkillRow, type SkillRowLabels } from './SkillRow.js';

export interface SkillsTabLabels extends SkillDraftFormLabels, SkillRowLabels {
  searchPlaceholder?: string;
  newSkillLabel?: string;
  sourceFilterLabel?: string;
  modeFilterLabel?: string;
  categoryFilterLabel?: string;
  allLabel?: string;
  noResultsLabel?: string;
  loadErrorLabel?: string;
}

export interface SkillsTabProps {
  port: SkillsPort;
  /** Ids of skills the operator has turned off. Controlled by the host, same
   *  "tab owns async edges, host owns cross-cutting config" split as every
   *  other tab in this feature — disabling a skill is a property of the
   *  host's own config, not the skill registry. */
  disabledSkillIds: ReadonlySet<string>;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  locale?: string;
  labels?: SkillsTabLabels | undefined;
}

/**
 * Skill library: search + source/mode/category filters, a create form, and
 * one collapsible row per skill (enable toggle, preview, file tree, inline
 * edit, two-click delete). Origin: `SkillsSection.tsx` — GENERIC (per
 * `SkillSummary`'s own doc), with `mode`/category vocabulary entirely
 * host-defined. All filtering/search/count logic is `@jini-ai/ui-core`'s;
 * this component only renders it.
 */
export function SkillsTab({ port, disabledSkillIds, onToggleEnabled, locale = 'en', labels }: SkillsTabProps) {
  const t = useT();
  const {
    loading,
    loadError,
    filters,
    setSearch,
    setSourceFilter,
    setModeFilter,
    setCategoryFilter,
    filteredSkills,
    sourceOptions,
    modeOptions,
    categoryOptions,
    expandedId,
    toggleExpanded,
    bodyById,
    bodyLoadingId,
    filesById,
    filesLoadingId,
    editingId,
    creating,
    draft,
    setDraft,
    draftError,
    draftSaving,
    startCreate,
    requestEdit,
    confirmBuiltInEditId,
    confirmBuiltInEdit,
    cancelBuiltInEdit,
    cancelDraft,
    submitDraft,
    confirmDeleteId,
    armDelete,
    cancelDelete,
    commitDelete,
  } = useSkillsTab({ port, locale });

  const searchPlaceholder = labels?.searchPlaceholder ?? t('Search skills…');
  const newSkillLabel = labels?.newSkillLabel ?? t('New skill');
  const sourceFilterLabel = labels?.sourceFilterLabel ?? t('Source');
  const modeFilterLabel = labels?.modeFilterLabel ?? t('Type');
  const categoryFilterLabel = labels?.categoryFilterLabel ?? t('Category');
  const allLabel = labels?.allLabel ?? t('All');
  const noResultsLabel = labels?.noResultsLabel ?? t('No skills match these filters.');
  const loadErrorLabel = labels?.loadErrorLabel ?? t('Could not load skills: {error}', { error: loadError ?? '' });

  return (
    <section className="jini-settings-section jini-settings-skills">
      <div className="jini-skills-toolbar">
        <div className="jini-skills-toolbar-top">
          <input
            type="search"
            className="jini-skills-search"
            placeholder={searchPlaceholder}
            value={filters.search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={searchPlaceholder}
          />
          <button type="button" className="jini-button jini-button-primary" onClick={startCreate} data-testid="skills-new">
            <Icon name="plus" size={13} />
            <span>{newSkillLabel}</span>
          </button>
        </div>

        <div className="jini-skills-filter-selects">
          <label className="jini-skills-filter-select">
            <span>{sourceFilterLabel}</span>
            <select value={filters.source} onChange={(event) => setSourceFilter(event.target.value as typeof filters.source)}>
              <option value="all">
                {allLabel} ({sourceOptions.all})
              </option>
              {sourceOptions.options.map(([value, count]) => (
                <option key={value} value={value}>
                  {value} ({count})
                </option>
              ))}
            </select>
          </label>

          <label className="jini-skills-filter-select">
            <span>{modeFilterLabel}</span>
            <select value={filters.mode} onChange={(event) => setModeFilter(event.target.value)}>
              <option value="all">
                {allLabel} ({modeOptions.all})
              </option>
              {modeOptions.options.map(([value, count]) => (
                <option key={value} value={value}>
                  {value} ({count})
                </option>
              ))}
            </select>
          </label>

          {categoryOptions ? (
            <label className="jini-skills-filter-select" data-testid="skills-category-filters">
              <span>{categoryFilterLabel}</span>
              <select value={filters.category} onChange={(event) => setCategoryFilter(event.target.value)}>
                <option value="all">
                  {allLabel} ({categoryOptions.all})
                </option>
                {categoryOptions.options.map(([value, count]) => (
                  <option key={value} value={value}>
                    {humanizeSkillCategory(value)} ({count})
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>

      {loadError ? (
        <div className="jini-empty-card jini-empty-card-error">
          <strong>{loadErrorLabel}</strong>
        </div>
      ) : null}

      {creating ? (
        <SkillDraftForm
          heading={newSkillLabel}
          draft={draft}
          onDraftChange={setDraft}
          error={draftError}
          saving={draftSaving}
          isEdit={false}
          onCancel={cancelDraft}
          onSubmit={submitDraft}
          labels={labels}
        />
      ) : null}

      {!loading && filteredSkills.length === 0 ? (
        <div className="jini-empty-card">
          <strong>{noResultsLabel}</strong>
        </div>
      ) : (
        <div className="jini-skills-rows" data-testid="skills-list">
          {filteredSkills.map((skill) => {
            const isExpanded = expandedId === skill.id;
            const isEditing = editingId === skill.id;
            return (
              <SkillRow
                key={skill.id}
                skill={skill}
                locale={locale}
                enabled={!disabledSkillIds.has(skill.id)}
                expanded={isExpanded}
                editing={isEditing}
                body={bodyById[skill.id]}
                bodyLoading={bodyLoadingId === skill.id}
                files={filesById[skill.id] ?? null}
                filesLoading={filesLoadingId === skill.id}
                confirmDelete={confirmDeleteId === skill.id}
                confirmBuiltInEdit={confirmBuiltInEditId === skill.id}
                draft={isEditing ? draft : null}
                draftError={isEditing ? draftError : null}
                draftSaving={isEditing && draftSaving}
                onDraftChange={setDraft}
                onToggleExpanded={() => toggleExpanded(skill.id)}
                onToggleEnabled={(enabled) => onToggleEnabled(skill.id, enabled)}
                onStartEdit={() => requestEdit(skill)}
                onConfirmBuiltInEdit={confirmBuiltInEdit}
                onCancelBuiltInEdit={cancelBuiltInEdit}
                onArmDelete={() => armDelete(skill.id)}
                onCancelDelete={cancelDelete}
                onCommitDelete={() => commitDelete(skill.id)}
                onCancelEdit={cancelDraft}
                onSubmitEdit={submitDraft}
                labels={labels}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
