import { useT } from '../../../i18n/index.js';
import { Icon } from '../../../../react/components/Icon.js';
import type { ProjectLocationsPort } from '../../ports.js';
import { locationLabel } from '../../rules.js';
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
    scanErrorLabel: 'Could not scan the new folder for existing projects.',
    scanCompleteTemplate: 'Imported {imported}, {existing} already tracked.',
  };
  for (const key of Object.keys(copy) as (keyof ProjectLocationsTabLabels)[]) {
    copy[key] = labels?.[key] ?? t(copy[key]);
  }
  return copy;
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
  const { drafts, builtIn, effectiveDefaultLocationId, saving, result, addFolder, removeDraft, setDefaultLocationId } =
    useProjectLocationsTab({ port, defaultLocationId, onDefaultLocationIdChange });

  const {
    title, description, builtInLabel, defaultBadge, makeDefaultLabel, deleteLabel, addFolderLabel, rowHint,
    noFolderSelectedLabel, duplicateLabel, savedLabel, defaultSavedLabel, saveErrorLabel, scanErrorLabel,
    scanCompleteTemplate,
  } = resolveLabels({ t }, labels);

  function defaultControlLabel(active: boolean): string {
    return active ? defaultBadge : makeDefaultLabel;
  }

  const notice = (() => {
    switch (result.status) {
      case 'no-folder-selected':
        return noFolderSelectedLabel;
      case 'duplicate':
        return duplicateLabel;
      case 'saved':
        return savedLabel;
      case 'default-saved':
        return defaultSavedLabel;
      case 'scan-complete':
        return t(scanCompleteTemplate, { imported: result.imported, existing: result.existing });
      default:
        return null;
    }
  })();
  const errorNotice = result.status === 'save-error' ? saveErrorLabel : result.status === 'scan-error' ? scanErrorLabel : null;

  return (
    <section className="jini-settings-section jini-settings-project-locations">
      <div className="jini-section-head">
        <div>
          <h4>{title}</h4>
          <p className="jini-hint">{description}</p>
        </div>
      </div>

      {builtIn ? (
        <div className="jini-project-location-card jini-project-location-card-built-in">
          <div className="jini-project-location-card-main">
            <strong>{builtInLabel}</strong>
            <code>{builtIn.path}</code>
          </div>
          <label className="jini-project-location-default-control">
            <input
              type="radio"
              name="jini-project-location-default"
              checked={effectiveDefaultLocationId === builtIn.id}
              onChange={() => setDefaultLocationId(builtIn.id)}
            />
            <span>{defaultControlLabel(effectiveDefaultLocationId === builtIn.id)}</span>
          </label>
        </div>
      ) : null}

      <div className="jini-project-location-list">
        {drafts.map((draft, index) => (
          <div className="jini-project-location-card" key={`${draft.id ?? 'new'}-${index}`}>
            <div className="jini-project-location-card-main">
              <strong>{locationLabel(draft.path)}</strong>
              <code>{draft.path}</code>
              <small className="jini-hint">{rowHint}</small>
            </div>
            {draft.id ? (
              <label className="jini-project-location-default-control">
                <input
                  type="radio"
                  name="jini-project-location-default"
                  checked={effectiveDefaultLocationId === draft.id}
                  onChange={() => setDefaultLocationId(draft.id!)}
                />
                <span>{defaultControlLabel(effectiveDefaultLocationId === draft.id)}</span>
              </label>
            ) : null}
            <button
              type="button"
              className="jini-button jini-button-ghost"
              onClick={() => removeDraft(index)}
              disabled={saving}
            >
              <Icon name="trash" size={13} />
              <span>{deleteLabel}</span>
            </button>
          </div>
        ))}
      </div>

      <button type="button" className="jini-button jini-button-ghost" onClick={addFolder} disabled={saving}>
        <Icon name="plus" size={12} />
        <span>{addFolderLabel}</span>
      </button>

      {notice ? (
        <p className="jini-hint" role="status">
          {notice}
        </p>
      ) : null}
      {errorNotice ? (
        <p className="jini-hint jini-hint-error" role="alert">
          {errorNotice}
        </p>
      ) : null}
    </section>
  );
}
