import { useT } from '../../../i18n/index.js';
import { createDefaultControlLabel } from './ProjectLocationsTab.hooks.js';
import { Icon } from '../../../../react/components/Icon.js';
import type { ProjectLocationsPort } from '../../ports.js';
import { locationLabel } from '../../rules.js';
import type { ProjectLocation } from '../../types.js';
import { useProjectLocationsTab } from '../hooks/useProjectLocationsTab.js';

export interface ProjectLocationsTabLabels {
  title?: string;
  description?: string;
  builtInLabel?: string;
  defaultBadge?: string;
  makeDefaultLabel?: string;
  deleteLabel?: string;
  addFolderLabel?: string;
  rowHint?: string;
  noFolderSelectedLabel?: string;
  duplicateLabel?: string;
  savedLabel?: string;
  defaultSavedLabel?: string;
  saveErrorLabel?: string;
  loadErrorLabel?: string;
  scanErrorLabel?: string;
  /** i18n template with `{imported}`/`{existing}` placeholders. */
  scanCompleteTemplate?: string;
}

export interface ProjectLocationsTabProps {
  port: ProjectLocationsPort;
  /** Host-configured default location id. See `useProjectLocationsTab` for
   *  how a stale value (naming a since-removed location) gets corrected. */
  defaultLocationId?: string | null;
  onDefaultLocationIdChange?: (id: string) => void;
  labels?: ProjectLocationsTabLabels;
}

function resolveLabels(
  { t }: { t: ReturnType<typeof useT> },
  labels: ProjectLocationsTabLabels = {},
): Required<ProjectLocationsTabLabels> {
  const copy = {
    title: 'Project locations',
    description: 'Where new projects are created and existing ones are found.',
    builtInLabel: 'Default location',
    defaultBadge: 'Default',
    makeDefaultLabel: 'Make default',
    deleteLabel: 'Delete',
    addFolderLabel: 'Add folder',
    rowHint: 'Used as a project root.',
    noFolderSelectedLabel: 'No folder selected.',
    duplicateLabel: 'That folder is already a project location.',
    savedLabel: 'Saved.',
    defaultSavedLabel: 'Default location updated.',
    saveErrorLabel: 'Could not save project locations.',
    loadErrorLabel: 'Could not load project locations.',
    scanErrorLabel: 'Could not scan the new folder for existing projects.',
    scanCompleteTemplate: 'Imported {imported}, {existing} already tracked.',
  };
  for (const key of Object.keys(copy) as (keyof ProjectLocationsTabLabels)[]) {
    copy[key] = labels?.[key] ?? t(copy[key]);
  }
  return copy;
}

type TabState = ReturnType<typeof useProjectLocationsTab>;
type ResolvedLabels = Required<ProjectLocationsTabLabels>;
type DefaultControlLabel = ReturnType<typeof createDefaultControlLabel>;

function resolveNotices(
  result: TabState['result'],
  labels: ResolvedLabels,
  t: ReturnType<typeof useT>,
): { notice: string | null; errorNotice: string | null } {
  const noticeByStatus: Partial<Record<typeof result.status, string>> = {
    'no-folder-selected': labels.noFolderSelectedLabel,
    duplicate: labels.duplicateLabel,
    saved: labels.savedLabel,
    'default-saved': labels.defaultSavedLabel,
  };
  const errorNoticeByStatus: Partial<Record<typeof result.status, string>> = {
    'save-error': labels.saveErrorLabel,
    'load-error': labels.loadErrorLabel,
    'scan-error': labels.scanErrorLabel,
  };
  const notice =
    result.status === 'scan-complete'
      ? t(labels.scanCompleteTemplate, { imported: result.imported, existing: result.existing })
      : (noticeByStatus[result.status] ?? null);
  return { notice, errorNotice: errorNoticeByStatus[result.status] ?? null };
}

interface DefaultRadioProps {
  checked: boolean;
  onSelect: () => void;
  label: string;
}

function DefaultLocationRadio({ checked, onSelect, label }: DefaultRadioProps) {
  return (
    <label className="jini-project-location-default-control">
      <input type="radio" name="jini-project-location-default" checked={checked} onChange={onSelect} />
      <span>{label}</span>
    </label>
  );
}

interface BuiltInCardProps {
  builtIn: ProjectLocation;
  label: string;
  checked: boolean;
  defaultLabel: string;
  onSelect: () => void;
}

function BuiltInLocationCard({ builtIn, label, checked, defaultLabel, onSelect }: BuiltInCardProps) {
  return (
    <div className="jini-project-location-card jini-project-location-card-built-in">
      <div className="jini-project-location-card-main">
        <strong>{label}</strong>
        <code>{builtIn.path}</code>
      </div>
      <DefaultLocationRadio checked={checked} onSelect={onSelect} label={defaultLabel} />
    </div>
  );
}

interface DraftCardProps {
  draft: TabState['drafts'][number];
  index: number;
  state: Pick<TabState, 'effectiveDefaultLocationId' | 'saving' | 'removeDraft' | 'setDefaultLocationId'>;
  labels: Pick<ResolvedLabels, 'rowHint' | 'deleteLabel'>;
  defaultControlLabel: DefaultControlLabel;
}

function DraftLocationCard({ draft, index, state, labels, defaultControlLabel }: DraftCardProps) {
  const isDefault = state.effectiveDefaultLocationId === draft.id;
  return (
    <div className="jini-project-location-card">
      <div className="jini-project-location-card-main">
        <strong>{locationLabel(draft.path)}</strong>
        <code>{draft.path}</code>
        <small className="jini-hint">{labels.rowHint}</small>
      </div>
      {draft.id ? (
        <DefaultLocationRadio
          checked={isDefault}
          onSelect={() => state.setDefaultLocationId(draft.id!)}
          label={defaultControlLabel(isDefault)}
        />
      ) : null}
      <button
        type="button"
        className="jini-button jini-button-ghost"
        onClick={() => state.removeDraft(index)}
        disabled={state.saving}
      >
        <Icon name="trash" size={13} />
        <span>{labels.deleteLabel}</span>
      </button>
    </div>
  );
}

/**
 * Configured project roots: the host's built-in default plus operator-added
 * folders, each markable as the new-project default and removable. Origin:
 * `ProjectLocationsSection.tsx` — GENERIC (see `ProjectLocation`'s doc), the
 * only host coupling being the folder-picker/persistence/scan calls, all
 * routed through the injected `ProjectLocationsPort`.
 */
export function ProjectLocationsTab({ port, defaultLocationId, onDefaultLocationIdChange, labels }: ProjectLocationsTabProps) {
  const t = useT();
  const state = useProjectLocationsTab({ port, defaultLocationId, onDefaultLocationIdChange });
  const { drafts, builtIn, effectiveDefaultLocationId, saving, result, addFolder, setDefaultLocationId } = state;
  const copy = resolveLabels({ t }, labels);
  const defaultControlLabel = createDefaultControlLabel({ defaultBadge: copy.defaultBadge, makeDefaultLabel: copy.makeDefaultLabel });
  const { notice, errorNotice } = resolveNotices(result, copy, t);

  return (
    <section className="jini-settings-section jini-settings-project-locations">
      <div className="jini-section-head">
        <div>
          <h4>{copy.title}</h4>
          <p className="jini-hint">{copy.description}</p>
        </div>
      </div>

      {builtIn ? (
        <BuiltInLocationCard
          builtIn={builtIn}
          label={copy.builtInLabel}
          checked={effectiveDefaultLocationId === builtIn.id}
          defaultLabel={defaultControlLabel(effectiveDefaultLocationId === builtIn.id)}
          onSelect={() => setDefaultLocationId(builtIn.id)}
        />
      ) : null}

      <div className="jini-project-location-list">
        {drafts.map((draft, index) => (
          <DraftLocationCard
            key={`${draft.id ?? 'new'}-${index}`}
            draft={draft}
            index={index}
            state={state}
            labels={copy}
            defaultControlLabel={defaultControlLabel}
          />
        ))}
      </div>

      <button type="button" className="jini-button jini-button-ghost" onClick={addFolder} disabled={saving}>
        <Icon name="plus" size={12} />
        <span>{copy.addFolderLabel}</span>
      </button>

      {notice ? <p className="jini-hint" role="status">{notice}</p> : null}
      {errorNotice ? <p className="jini-hint jini-hint-error" role="alert">{errorNotice}</p> : null}
    </section>
  );
}
