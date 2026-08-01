import type { SkillDraft, SkillDraftError, SkillFileEntry, SkillSummary } from '@jini-ai/ui-core';
import { formatSkillFileSize, humanizeSkillCategory, isBuiltInSkill, isDeletableSkill, localizedSkillDescription, localizedSkillName, skillFileLeafName, skillFileTreeIndent } from '@jini-ai/ui-core';
import { useT } from '../../../i18n/index.js';
import { Icon } from '../../../../react/components/Icon.js';
import { SkillDraftForm, type SkillDraftFormLabels } from './SkillDraftForm.js';

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
}: SkillRowProps) {
  const t = useT();
  const name = localizedSkillName(skill, locale) || skill.id;
  const description = localizedSkillDescription(skill, locale);
  const canDelete = isDeletableSkill(skill);
  const builtIn = isBuiltInSkill(skill);

  const expandLabel = labels?.expandLabel ?? t('Expand');
  const collapseLabel = labels?.collapseLabel ?? t('Collapse');
  const editLabel = labels?.editLabel ?? t('Edit');
  const overrideCreateLabel = labels?.overrideCreateLabel ?? t('Create override');
  const deleteLabel = labels?.deleteLabel ?? t('Delete');
  const deleteConfirmLabel = labels?.deleteConfirmLabel ?? t('Confirm delete');
  const cancelLabel = labels?.cancelLabel ?? t('Cancel');
  const enableToggleLabel = labels?.enableToggleLabel ?? t('Enabled');
  const loadingLabel = labels?.loadingLabel ?? t('Loading…');
  const filesHeading = labels?.filesHeading ?? t('Files');
  const noFilesLabel = labels?.noFilesLabel ?? t('No files.');
  const bodyHeading = labels?.bodyHeading ?? t('SKILL.md');
  const userBadge = labels?.userBadge ?? t('user');
  const overrideWarning =
    labels?.overrideWarning ?? t('This skill ships with the host. Editing it creates your own copy — the original is unaffected.');

  return (
    <div
      className={`jini-skills-row${enabled ? '' : ' jini-skills-row-disabled'}${expanded ? ' jini-skills-row-expanded' : ''}`}
      data-testid={`skill-row-${skill.id}`}
    >
      <div className="jini-skills-row-head">
        <button
          type="button"
          className="jini-skills-row-summary-btn"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          title={expanded ? collapseLabel : expandLabel}
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
              {skill.source === 'user' ? <span className="jini-skills-row-summary-source">{userBadge}</span> : null}
            </span>
            {description ? <span className="jini-hint">{description}</span> : null}
          </span>
          <Icon name="chevron-down" size={14} aria-hidden="true" />
        </button>

        <div className="jini-skills-row-actions">
          {canDelete && confirmDelete ? (
            <span className="jini-skills-delete-confirm" role="group">
              <button type="button" className="jini-button jini-button-danger" onClick={onCommitDelete} data-testid="skills-delete-confirm">
                {deleteConfirmLabel}
              </button>
              <button type="button" className="jini-button jini-button-ghost" onClick={onCancelDelete}>
                {cancelLabel}
              </button>
            </span>
          ) : (
            <>
              <button
                type="button"
                className="jini-button jini-button-ghost"
                onClick={onStartEdit}
                aria-label={builtIn ? overrideCreateLabel : editLabel}
                title={builtIn ? overrideCreateLabel : editLabel}
                data-testid="skills-edit"
              >
                <Icon name="edit" size={13} />
              </button>
              {canDelete ? (
                <button
                  type="button"
                  className="jini-button jini-button-ghost"
                  onClick={onArmDelete}
                  aria-label={deleteLabel}
                  title={deleteLabel}
                  data-testid="skills-delete"
                >
                  <Icon name="close" size={13} />
                </button>
              ) : null}
            </>
          )}
          {/* `toggle-switch`/`toggle-switch-sm` + a `.toggle-slider` sibling is
              OD's real switch chrome (`viewer/memory.css`), ported wholesale
              during the 2026-07-31 OD-parity pass — see settings-dialog.css's
              own comment on `.toggle-switch`. This previously wrapped the
              checkbox in `.jini-toggle-row` (built for Privacy's full-width
              standalone toggle rows) with no slider span at all, so the CSS
              track+thumb (`input:checked + .toggle-slider`) had no element to
              attach to and could never render regardless of styling. */}
          <label className="toggle-switch toggle-switch-sm jini-skills-row-enable" title={enableToggleLabel}>
            <input type="checkbox" checked={enabled} onChange={(event) => onToggleEnabled(event.target.checked)} aria-label={enableToggleLabel} />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>

      {confirmBuiltInEdit ? (
        <div className="jini-empty-card jini-empty-card-warning" role="alert" data-testid="skills-edit-builtin-warning">
          <p>{overrideWarning}</p>
          <div className="jini-skills-draft-actions">
            <button type="button" className="jini-button jini-button-ghost" onClick={onCancelBuiltInEdit} data-testid="skills-edit-builtin-cancel">
              {cancelLabel}
            </button>
            <button type="button" className="jini-button jini-button-primary" onClick={onConfirmBuiltInEdit} data-testid="skills-edit-builtin-confirm">
              {overrideCreateLabel}
            </button>
          </div>
        </div>
      ) : null}

      {expanded && !editing ? (
        <div className="jini-skills-row-detail">
          <div className="jini-settings-subsection">
            <h5>{bodyHeading}</h5>
            {bodyLoading ? <p className="jini-hint">{loadingLabel}</p> : <pre className="jini-skills-body-preview">{body ?? ''}</pre>}
          </div>
          <div className="jini-settings-subsection">
            <h5>{filesHeading}</h5>
            {filesLoading ? (
              <p className="jini-hint">{loadingLabel}</p>
            ) : !files || files.length === 0 ? (
              <p className="jini-hint">{noFilesLabel}</p>
            ) : (
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
            )}
          </div>
        </div>
      ) : null}

      {editing && draft ? (
        <SkillDraftForm
          heading={builtIn ? overrideCreateLabel : editLabel}
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
        />
      ) : null}
    </div>
  );
}
