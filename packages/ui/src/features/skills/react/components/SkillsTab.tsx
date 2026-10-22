import { agentHandleProps, agentSubHandle, buildAgentListHandles } from '@jini-ai/agentic';
import type { SkillsPort } from '../../ports.js';
import { humanizeSkillCategory } from '../../rules.js';
import { useT } from '../../../i18n/index.js';
import { Icon } from '../../../../react/components/Icon.js';
import { useSkillsTab, type SkillFilterRow, type UseSkillsTabResult } from '../hooks/useSkillsTab.js';
import { SkillDraftForm, type SkillDraftFormLabels } from './SkillDraftForm.js';
import { resolveLabels } from './SkillDraftForm.labels.js';
import { SkillRow, type SkillRowLabels } from './SkillRow.js';
import { DEFAULT_SKILLS_TAB_LABELS, type ResolvedSkillsTabLabels } from './SkillsTab.labels.js';

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
  /**
   * This tab's own agent handle, published by the host. The search box, the new-skill button, the
   * filter selects, the create form, and every skill row (each with its own distinct sub-handle,
   * derived from the skill's own stable id) all derive their own `data-agent-*` handle from this
   * ONE base.
   */
  agentHandle?: string;
}

/**
 * Skill library: search + source/mode/category filters, a create form, and
 * one collapsible row per skill (enable toggle, preview, file tree, inline
 * edit, two-click delete). Origin: `SkillsSection.tsx` — GENERIC (per
 * `SkillSummary`'s own doc), with `mode`/category vocabulary entirely
 * host-defined. All filtering/search/count logic lives in this feature's
 * own `rules.ts`; this component only renders it.
 */
export function SkillsTab({ port, disabledSkillIds, onToggleEnabled, locale = 'en', labels, agentHandle }: SkillsTabProps) {
  const t = useT();
  const tab = useSkillsTab({ port, locale });
  const l = resolveLabels({ defaults: DEFAULT_SKILLS_TAB_LABELS, t }, { labels });
  const loadErrorLabel = labels?.loadErrorLabel ?? t('Could not load skills: {error}', { error: tab.loadError ?? '' });

  return (
    <section className="jini-settings-section jini-settings-skills">
      <SkillsTabToolbar tab={tab} labels={l} agentHandle={agentHandle} />

      {tab.loadError ? (
        <div className="jini-empty-card jini-empty-card-error">
          <strong>{loadErrorLabel}</strong>
        </div>
      ) : null}

      {tab.creating ? (
        <SkillDraftForm
          heading={l.newSkillLabel}
          draft={tab.draft}
          onDraftChange={tab.setDraft}
          error={tab.draftError}
          saving={tab.draftSaving}
          isEdit={false}
          onCancel={tab.cancelDraft}
          onSubmit={tab.submitDraft}
          labels={labels}
          {...(agentHandle ? { agentHandle: agentSubHandle({ base: agentHandle, action: 'create-form' }) } : {})}
        />
      ) : null}

      {!tab.loading && tab.filteredSkills.length === 0 ? (
        <div className="jini-empty-card">
          <strong>{l.noResultsLabel}</strong>
        </div>
      ) : (
        <SkillsTabRows
          tab={tab}
          disabledSkillIds={disabledSkillIds}
          onToggleEnabled={onToggleEnabled}
          locale={locale}
          labels={labels}
          agentHandle={agentHandle}
        />
      )}
    </section>
  );
}

/** Search box, "New skill" button, and the source/mode/(category) selects. */
function SkillsTabToolbar({
  tab,
  labels: l,
  agentHandle,
}: {
  tab: UseSkillsTabResult;
  labels: ResolvedSkillsTabLabels;
  agentHandle: string | undefined;
}) {
  const { filters, categoryOptions } = tab;
  return (
    <div className="jini-skills-toolbar">
      <div className="jini-skills-toolbar-top">
        <input
          type="search"
          className="jini-skills-search"
          placeholder={l.searchPlaceholder}
          value={filters.search}
          onChange={(event) => tab.setSearch(event.target.value)}
          aria-label={l.searchPlaceholder}
          {...agentHandleProps({}, { base: agentHandle, action: 'search', role: 'field', label: l.searchPlaceholder })}
        />
        <button
          type="button"
          className="jini-button jini-button-primary"
          onClick={tab.startCreate}
          data-testid="skills-new"
          {...agentHandleProps({}, { base: agentHandle, action: 'new', role: 'button', label: l.newSkillLabel })}
        >
          <Icon name="plus" size={13} />
          <span>{l.newSkillLabel}</span>
        </button>
      </div>

      <div className="jini-skills-filter-selects">
        <SkillFilterSelect
          label={l.sourceFilterLabel}
          allLabel={l.allLabel}
          value={filters.source}
          row={tab.sourceOptions}
          onChange={(value) => tab.setSourceFilter(value as typeof filters.source)}
          action="filter-source"
          agentHandle={agentHandle}
        />
        <SkillFilterSelect
          label={l.modeFilterLabel}
          allLabel={l.allLabel}
          value={filters.mode}
          row={tab.modeOptions}
          onChange={tab.setModeFilter}
          action="filter-mode"
          agentHandle={agentHandle}
        />
        {categoryOptions ? (
          <SkillFilterSelect
            label={l.categoryFilterLabel}
            allLabel={l.allLabel}
            value={filters.category}
            row={categoryOptions}
            onChange={tab.setCategoryFilter}
            action="filter-category"
            agentHandle={agentHandle}
            formatValue={humanizeSkillCategory}
            testId="skills-category-filters"
          />
        ) : null}
      </div>
    </div>
  );
}

const identity = (value: string): string => value;

/** One labelled filter `<select>`: an "All (n)" option then one per value. */
function SkillFilterSelect({
  label,
  allLabel,
  value,
  row,
  onChange,
  action,
  agentHandle,
  formatValue = identity,
  testId,
}: {
  label: string;
  allLabel: string;
  value: string;
  row: SkillFilterRow;
  onChange: (value: string) => void;
  action: string;
  agentHandle: string | undefined;
  /** Category slugs are shown humanized; source/mode values are shown raw. */
  formatValue?: (value: string) => string;
  testId?: string;
}) {
  return (
    <label className="jini-skills-filter-select" data-testid={testId}>
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...agentHandleProps({}, { base: agentHandle, action, role: 'field', label })}
      >
        <option value="all">
          {allLabel} ({row.all})
        </option>
        {row.options.map(([optionValue, count]) => (
          <option key={optionValue} value={optionValue}>
            {formatValue(optionValue)} ({count})
          </option>
        ))}
      </select>
    </label>
  );
}

/** One `SkillRow` per filtered skill, each with its own derived agent handle. */
function SkillsTabRows({
  tab,
  disabledSkillIds,
  onToggleEnabled,
  locale,
  labels,
  agentHandle,
}: {
  tab: UseSkillsTabResult;
  disabledSkillIds: ReadonlySet<string>;
  onToggleEnabled: SkillsTabProps['onToggleEnabled'];
  locale: string;
  labels: SkillsTabLabels | undefined;
  agentHandle: string | undefined;
}) {
  const { filteredSkills, draft, draftError, draftSaving } = tab;
  const rowHandles = agentHandle
    ? buildAgentListHandles({ prefix: agentSubHandle({ base: agentHandle, action: 'skill' }), ids: filteredSkills.map((skill) => skill.id) })
    : undefined;
  return (
    <div className="jini-skills-rows" data-testid="skills-list">
      {filteredSkills.map((skill, index) => {
        const isEditing = tab.editingId === skill.id;
        return (
          <SkillRow
            key={skill.id}
            {...(rowHandles?.[index] ? { agentHandle: rowHandles[index] } : {})}
            skill={skill}
            locale={locale}
            enabled={!disabledSkillIds.has(skill.id)}
            expanded={tab.expandedId === skill.id}
            editing={isEditing}
            body={tab.bodyById[skill.id]}
            bodyLoading={tab.bodyLoadingId === skill.id}
            files={tab.filesById[skill.id] ?? null}
            filesLoading={tab.filesLoadingId === skill.id}
            confirmDelete={tab.confirmDeleteId === skill.id}
            confirmBuiltInEdit={tab.confirmBuiltInEditId === skill.id}
            draft={isEditing ? draft : null}
            draftError={isEditing ? draftError : null}
            draftSaving={isEditing && draftSaving}
            onDraftChange={tab.setDraft}
            onToggleExpanded={() => tab.toggleExpanded(skill.id)}
            onToggleEnabled={(enabled) => onToggleEnabled(skill.id, enabled)}
            onStartEdit={() => tab.requestEdit(skill)}
            onConfirmBuiltInEdit={tab.confirmBuiltInEdit}
            onCancelBuiltInEdit={tab.cancelBuiltInEdit}
            onArmDelete={() => tab.armDelete(skill.id)}
            onCancelDelete={tab.cancelDelete}
            onCommitDelete={() => tab.commitDelete(skill.id)}
            onCancelEdit={tab.cancelDraft}
            onSubmitEdit={tab.submitDraft}
            labels={labels}
          />
        );
      })}
    </div>
  );
}
