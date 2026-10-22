import { agentHandleProps, agentSubHandle } from '@jini-ai/agentic';
import {
  formatSkillFileSize,
  humanizeSkillCategory,
  isBuiltInSkill,
  isDeletableSkill,
  localizedSkillDescription,
  localizedSkillName,
  skillFileLeafName,
  skillFileTreeIndent,
} from '../../rules.js';
import type { SkillDraft, SkillDraftError, SkillFileEntry, SkillSummary } from '../../types.js';
import { useT } from '../../../i18n/index.js';
import { Icon } from '../../../../react/components/Icon.js';
import { SkillDraftForm, type SkillDraftFormLabels } from './SkillDraftForm.js';
import { resolveLabels } from './SkillDraftForm.labels.js';
import { DEFAULT_SKILL_ROW_LABELS, type ResolvedSkillRowLabels } from './SkillRow.labels.js';

export interface SkillRowLabels extends SkillDraftFormLabels {
  expandLabel?: string;
  collapseLabel?: string;
  editLabel?: string;
  overrideCreateLabel?: string;
  deleteLabel?: string;
  deleteConfirmLabel?: string;
  cancelLabel?: string;
  enableToggleLabel?: string;
  loadingLabel?: string;
  filesHeading?: string;
  noFilesLabel?: string;
  bodyHeading?: string;
  userBadge?: string;
  overrideWarning?: string;
}

export interface SkillRowProps {
  skill: SkillSummary;
  locale: string;
  enabled: boolean;
  expanded: boolean;
  editing: boolean;
  body: string | undefined;
  bodyLoading: boolean;
  files: readonly SkillFileEntry[] | null;
  filesLoading: boolean;
  confirmDelete: boolean;
  confirmBuiltInEdit: boolean;
  draft: SkillDraft | null;
  draftError: SkillDraftError | null;
  draftSaving: boolean;
  onDraftChange: (updater: (draft: SkillDraft) => SkillDraft) => void;
  onToggleExpanded: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onStartEdit: () => void;
  onConfirmBuiltInEdit: () => void;
  onCancelBuiltInEdit: () => void;
  onArmDelete: () => void;
  onCancelDelete: () => void;
  onCommitDelete: () => void;
  onCancelEdit: () => void;
  onSubmitEdit: () => void;
  labels?: SkillRowLabels | undefined;
  /** This row's own agent handle — `SkillsTab` derives one per skill via `buildAgentListHandles`. */
  agentHandle?: string;
}

/**
 * One collapsible skill row: header (enable toggle, name, mode/category/
 * source badges, edit/delete actions) always visible; body preview + file
 * tree, or an inline edit form, revealed only when expanded. Origin:
 * `SkillRow` in `SkillsSection.tsx`.
 */
export function SkillRow({
  skill,
  locale,
  enabled,
  expanded,
  editing,
  body,
  bodyLoading,
  files,
  filesLoading,
  confirmDelete,
  confirmBuiltInEdit,
  draft,
  draftError,
  draftSaving,
  onDraftChange,
  onToggleExpanded,
  onToggleEnabled,
  onStartEdit,
  onConfirmBuiltInEdit,
  onCancelBuiltInEdit,
  onArmDelete,
  onCancelDelete,
  onCommitDelete,
  onCancelEdit,
  onSubmitEdit,
  labels,
  agentHandle,
}: SkillRowProps) {
  const l = resolveLabels({ defaults: DEFAULT_SKILL_ROW_LABELS, t: useT() }, { labels });
  const builtIn = isBuiltInSkill(skill);
  // Built-in skills are never edited in place — "editing" one creates a
  // user-owned override, so every edit affordance says so.
  const editActionLabel = builtIn ? l.overrideCreateLabel : l.editLabel;

  return (
    <div className={skillRowClassName({ enabled, expanded })} data-testid={`skill-row-${skill.id}`}>
      <div className="jini-skills-row-head">
        <SkillRowSummaryButton
          skill={skill}
          locale={locale}
          expanded={expanded}
          onToggleExpanded={onToggleExpanded}
          labels={l}
          agentHandle={agentHandle}
        />

        <div className="jini-skills-row-actions">
          {isDeletableSkill(skill) && confirmDelete ? (
            <SkillRowDeleteConfirm
              onCommitDelete={onCommitDelete}
              onCancelDelete={onCancelDelete}
              labels={l}
              agentHandle={agentHandle}
            />
          ) : (
            <SkillRowEditDeleteActions
              skill={skill}
              editActionLabel={editActionLabel}
              onStartEdit={onStartEdit}
              onArmDelete={onArmDelete}
              labels={l}
              agentHandle={agentHandle}
            />
          )}
          {/* `toggle-switch`/`toggle-switch-sm` + a `.toggle-slider` sibling is
              OD's real switch chrome (`viewer/memory.css`), ported wholesale
              during the 2026-07-31 OD-parity pass — see settings-dialog.css's
              own comment on `.toggle-switch`. This previously wrapped the
              checkbox in `.jini-toggle-row` (built for Privacy's full-width
              standalone toggle rows) with no slider span at all, so the CSS
              track+thumb (`input:checked + .toggle-slider`) had no element to
              attach to and could never render regardless of styling. */}
          <label className="toggle-switch toggle-switch-sm jini-skills-row-enable" title={l.enableToggleLabel}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => onToggleEnabled(event.target.checked)}
              aria-label={l.enableToggleLabel}
              {...agentHandleProps({}, { base: agentHandle, action: 'enabled', role: 'checkbox', label: l.enableToggleLabel })}
            />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>

      {confirmBuiltInEdit ? (
        <SkillRowBuiltInEditWarning
          onCancelBuiltInEdit={onCancelBuiltInEdit}
          onConfirmBuiltInEdit={onConfirmBuiltInEdit}
          labels={l}
          agentHandle={agentHandle}
        />
      ) : null}

      {expanded && !editing ? (
        <SkillRowDetail body={body} bodyLoading={bodyLoading} files={files} filesLoading={filesLoading} labels={l} />
      ) : null}

      {editing && draft ? (
        <SkillDraftForm
          heading={editActionLabel}
          subheading={skill.id}
          draft={draft}
          onDraftChange={onDraftChange}
          error={draftError}
          saving={draftSaving}
          isEdit
          isBuiltInOverride={builtIn}
          onCancel={onCancelEdit}
          onSubmit={onSubmitEdit}
          labels={labels}
          {...(agentHandle ? { agentHandle: agentSubHandle({ base: agentHandle, action: 'edit-form' }) } : {})}
        />
      ) : null}
    </div>
  );
}

function skillRowClassName({ enabled, expanded }: { enabled: boolean; expanded: boolean }): string {
  return `jini-skills-row${enabled ? '' : ' jini-skills-row-disabled'}${expanded ? ' jini-skills-row-expanded' : ''}`;
}

interface RowPartProps {
  labels: ResolvedSkillRowLabels;
  agentHandle: string | undefined;
}

/** The always-visible header button: name, mode/category/source badges, description. */
function SkillRowSummaryButton({
  skill,
  locale,
  expanded,
  onToggleExpanded,
  labels: l,
  agentHandle,
}: RowPartProps & Pick<SkillRowProps, 'skill' | 'locale' | 'expanded' | 'onToggleExpanded'>) {
  const name = localizedSkillName(skill, locale) || skill.id;
  const description = localizedSkillDescription(skill, locale);
  return (
    <button
      type="button"
      className="jini-skills-row-summary-btn"
      onClick={onToggleExpanded}
      aria-expanded={expanded}
      title={expanded ? l.collapseLabel : l.expandLabel}
      {...agentHandleProps({}, { base: agentHandle, action: 'expand', role: 'button', label: name })}
    >
      <Icon name="puzzle" size={14} aria-hidden="true" />
      <span className="jini-skills-row-summary">
        <span className="jini-skills-row-summary-line">
          <strong>{name}</strong>
          <span className="jini-skills-row-summary-mode">{skill.mode}</span>
          {skill.category ? (
            <span className="jini-skills-row-summary-category" title={humanizeSkillCategory(skill.category)}>
              {humanizeSkillCategory(skill.category)}
            </span>
          ) : null}
          {skill.source === 'user' ? <span className="jini-skills-row-summary-source">{l.userBadge}</span> : null}
        </span>
        {description ? <span className="jini-hint">{description}</span> : null}
      </span>
      <Icon name="chevron-down" size={14} aria-hidden="true" />
    </button>
  );
}

/** The armed-delete confirm/cancel pair that replaces the row actions. */
function SkillRowDeleteConfirm({
  onCommitDelete,
  onCancelDelete,
  labels: l,
  agentHandle,
}: RowPartProps & Pick<SkillRowProps, 'onCommitDelete' | 'onCancelDelete'>) {
  return (
    <span className="jini-skills-delete-confirm" role="group">
      <button
        type="button"
        className="jini-button jini-button-danger"
        onClick={onCommitDelete}
        data-testid="skills-delete-confirm"
        {...agentHandleProps({}, { base: agentHandle, action: 'delete-confirm', role: 'button', label: l.deleteConfirmLabel })}
      >
        {l.deleteConfirmLabel}
      </button>
      <button
        type="button"
        className="jini-button jini-button-ghost"
        onClick={onCancelDelete}
        {...agentHandleProps({}, { base: agentHandle, action: 'delete-cancel', role: 'button', label: l.cancelLabel })}
      >
        {l.cancelLabel}
      </button>
    </span>
  );
}

/** Edit (or create-override) plus, for a user-owned skill only, delete. */
function SkillRowEditDeleteActions({
  skill,
  editActionLabel,
  onStartEdit,
  onArmDelete,
  labels: l,
  agentHandle,
}: RowPartProps & Pick<SkillRowProps, 'skill' | 'onStartEdit' | 'onArmDelete'> & { editActionLabel: string }) {
  return (
    <>
      <button
        type="button"
        className="jini-button jini-button-ghost"
        onClick={onStartEdit}
        aria-label={editActionLabel}
        title={editActionLabel}
        data-testid="skills-edit"
        {...agentHandleProps({}, { base: agentHandle, action: 'edit', role: 'button', label: editActionLabel })}
      >
        <Icon name="edit" size={13} />
      </button>
      {isDeletableSkill(skill) ? (
        <button
          type="button"
          className="jini-button jini-button-ghost"
          onClick={onArmDelete}
          aria-label={l.deleteLabel}
          title={l.deleteLabel}
          data-testid="skills-delete"
          {...agentHandleProps({}, { base: agentHandle, action: 'delete', role: 'button', label: l.deleteLabel })}
        >
          <Icon name="close" size={13} />
        </button>
      ) : null}
    </>
  );
}

/** The "editing a built-in creates an override" confirmation card. */
function SkillRowBuiltInEditWarning({
  onCancelBuiltInEdit,
  onConfirmBuiltInEdit,
  labels: l,
  agentHandle,
}: RowPartProps & Pick<SkillRowProps, 'onCancelBuiltInEdit' | 'onConfirmBuiltInEdit'>) {
  return (
    <div className="jini-empty-card jini-empty-card-warning" role="alert" data-testid="skills-edit-builtin-warning">
      <p>{l.overrideWarning}</p>
      <div className="jini-skills-draft-actions">
        <button
          type="button"
          className="jini-button jini-button-ghost"
          onClick={onCancelBuiltInEdit}
          data-testid="skills-edit-builtin-cancel"
          {...agentHandleProps({}, { base: agentHandle, action: 'builtin-edit-cancel', role: 'button', label: l.cancelLabel })}
        >
          {l.cancelLabel}
        </button>
        <button
          type="button"
          className="jini-button jini-button-primary"
          onClick={onConfirmBuiltInEdit}
          data-testid="skills-edit-builtin-confirm"
          {...agentHandleProps({}, { base: agentHandle, action: 'builtin-edit-confirm', role: 'button', label: l.overrideCreateLabel })}
        >
          {l.overrideCreateLabel}
        </button>
      </div>
    </div>
  );
}

/** The expanded, non-editing detail: SKILL.md preview plus the file tree. */
function SkillRowDetail({
  body,
  bodyLoading,
  files,
  filesLoading,
  labels: l,
}: Pick<RowPartProps, 'labels'> & Pick<SkillRowProps, 'body' | 'bodyLoading' | 'files' | 'filesLoading'>) {
  return (
    <div className="jini-skills-row-detail">
      <div className="jini-settings-subsection">
        <h5>{l.bodyHeading}</h5>
        {bodyLoading ? <p className="jini-hint">{l.loadingLabel}</p> : <pre className="jini-skills-body-preview">{body ?? ''}</pre>}
      </div>
      <div className="jini-settings-subsection">
        <h5>{l.filesHeading}</h5>
        <SkillFileTree files={files} filesLoading={filesLoading} labels={l} />
      </div>
    </div>
  );
}

function SkillFileTree({
  files,
  filesLoading,
  labels: l,
}: Pick<RowPartProps, 'labels'> & Pick<SkillRowProps, 'files' | 'filesLoading'>) {
  if (filesLoading) return <p className="jini-hint">{l.loadingLabel}</p>;
  if (!files || files.length === 0) return <p className="jini-hint">{l.noFilesLabel}</p>;
  return (
    <ul className="jini-skills-file-tree">
      {files.map((entry) => (
        <li key={entry.path} className="jini-skills-file-entry" style={{ paddingLeft: skillFileTreeIndent(entry.path) }}>
          <Icon name={entry.kind === 'directory' ? 'folder' : 'file'} size={12} />
          <span>{skillFileLeafName(entry.path)}</span>
          {entry.kind === 'file' && typeof entry.size === 'number' ? (
            <span className="jini-hint">{formatSkillFileSize(entry.size)}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
