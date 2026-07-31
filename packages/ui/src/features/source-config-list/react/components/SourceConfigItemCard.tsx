import { useState } from 'react';
import { useT } from '../../../i18n/index.js';
import { maskFieldValue, sourceDisplayLabel } from '@jini-ai/ui-core';
import { SourceConfigField } from './SourceConfigField.js';
import { SourceConfigTestControl } from './SourceConfigTestControl.js';
import type { SourceConfigListCapabilities } from '../hooks/useSourceConfigList.js';
import type { SourceConfigItem, SourceFieldSpec, SourceFieldValues, SourceTestResult, SourceTrustOption, SourceUpdateInput } from '@jini-ai/ui-core';

export interface SourceConfigItemCardProps<TSource extends SourceConfigItem> {
  source: TSource;
  fieldSpecs: readonly SourceFieldSpec[];
  trustOptions?: readonly SourceTrustOption[];
  capabilities: SourceConfigListCapabilities;
  removing: boolean;
  refreshing: boolean;
  settingTrust: boolean;
  testing: boolean;
  /** Set while a `label`/`enabled`/`fields` patch (see `ports.ts`'s `updateSource`) is in flight for this item. */
  updating: boolean;
  testResult?: SourceTestResult;
  onRefresh: () => void;
  onRemove: () => void;
  onTrustChange: (trust: string) => void;
  onTest: () => void;
  /** Patches this item's `label`/`enabled`/`fields`. Only ever called when `capabilities.canUpdate` is true. */
  onUpdate: (patch: SourceUpdateInput) => void;
}

/**
 * One configured source: a collapsed summary row (an always-visible
 * enable/disable toggle when the source declares `enabled` at all, plus
 * label + trust badge/select) that expands to show every field (masked for
 * `password`-kind values) and the per-item refresh/remove/test actions —
 * capability-gated by which optional port methods the host's `capabilities`
 * reports, so a source shape with no trust concept (the origin MCP-server
 * shape) never renders a trust control at all. Ported in spirit from
 * `McpClientSection.tsx`'s expand-to-edit `McpRow` (enable toggle + editable
 * label/fields when expanded) and `PluginsView.tsx`'s `SourcesPanel`
 * marketplace card.
 */
export function SourceConfigItemCard<TSource extends SourceConfigItem>({
  source,
  fieldSpecs,
  trustOptions,
  capabilities,
  removing,
  refreshing,
  settingTrust,
  testing,
  updating,
  testResult,
  onRefresh,
  onRemove,
  onTrustChange,
  onTest,
  onUpdate,
}: SourceConfigItemCardProps<TSource>) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState('');
  const [editFields, setEditFields] = useState<SourceFieldValues>({});
  const label = sourceDisplayLabel(source, fieldSpecs);
  const trustOption = trustOptions?.find((option) => option.value === source.trust);
  const editableTrustOptions = capabilities.canSetTrust && trustOptions && trustOptions.length > 0 ? trustOptions : null;
  const anyActionPending = removing || refreshing || settingTrust || updating;

  const startEditing = () => {
    setEditLabel(source.label ?? '');
    setEditFields({ ...source.fields });
    setEditing(true);
  };
  const cancelEditing = () => setEditing(false);
  const saveEditing = () => {
    onUpdate({ label: editLabel, fields: editFields });
    setEditing(false);
  };

  return (
    <article className={`source-config-item-card${expanded ? ' is-expanded' : ''}`} data-testid="source-config-item-card">
      <div className="source-config-item-card-head">
        {source.enabled !== undefined && capabilities.canUpdate ? (
          <label className="source-config-item-card-enabled-toggle" title={source.enabled ? t('Enabled') : t('Disabled')}>
            <input
              type="checkbox"
              checked={source.enabled}
              disabled={updating}
              aria-label={t('Enable {name}', { name: label })}
              onChange={(event) => onUpdate({ enabled: event.target.checked })}
            />
          </label>
        ) : null}
        <button
          type="button"
          className="source-config-item-card-summary"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
        >
          <span className="source-config-item-card-label">{label}</span>
          {source.trust ? (
            <span className="source-config-item-card-trust-badge">{t(trustOption?.label ?? source.trust)}</span>
          ) : null}
        </button>
        <div className="source-config-item-card-actions">
          {editableTrustOptions ? (
            <select
              value={source.trust ?? ''}
              disabled={settingTrust}
              aria-label={t('Trust level for {name}', { name: label })}
              onChange={(event) => onTrustChange(event.target.value)}
            >
              {!source.trust ? (
                <option value="" disabled hidden>
                  {t('Select…')}
                </option>
              ) : null}
              {editableTrustOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.label)}
                </option>
              ))}
            </select>
          ) : null}
          {capabilities.canRefresh ? (
            <button type="button" onClick={onRefresh} disabled={anyActionPending}>
              {refreshing ? t('Refreshing…') : t('Refresh')}
            </button>
          ) : null}
          <button type="button" className="source-config-item-card-remove" onClick={onRemove} disabled={anyActionPending}>
            {removing ? t('Removing…') : t('Remove')}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="source-config-item-card-body">
          {capabilities.canUpdate ? (
            <div className="source-config-item-card-edit-toggle">
              {editing ? (
                <>
                  <button type="button" onClick={saveEditing} disabled={updating}>
                    {t('Save')}
                  </button>
                  <button type="button" onClick={cancelEditing} disabled={updating}>
                    {t('Cancel')}
                  </button>
                </>
              ) : (
                <button type="button" onClick={startEditing} disabled={anyActionPending}>
                  {t('Edit')}
                </button>
              )}
            </div>
          ) : null}
          {editing ? (
            <div className="source-config-item-card-edit-fields">
              <label className="source-config-field" htmlFor={`source-config-item-card-${source.id}-label`}>
                <span className="source-config-field-label">{t('Label')}</span>
                <input
                  id={`source-config-item-card-${source.id}-label`}
                  type="text"
                  value={editLabel}
                  placeholder={label}
                  onChange={(event) => setEditLabel(event.target.value)}
                />
              </label>
              {fieldSpecs.map((spec) => (
                <SourceConfigField
                  key={spec.key}
                  spec={spec}
                  value={editFields[spec.key] ?? ''}
                  idPrefix={`source-config-item-card-${source.id}-field`}
                  onChange={(value) => setEditFields((current) => ({ ...current, [spec.key]: value }))}
                />
              ))}
            </div>
          ) : (
            <dl className="source-config-item-card-fields">
              {fieldSpecs.map((spec) => (
                <div key={spec.key} className="source-config-item-card-field">
                  <dt>{t(spec.label)}</dt>
                  <dd>{maskFieldValue(spec.kind, source.fields[spec.key] ?? '')}</dd>
                </div>
              ))}
            </dl>
          )}
          {capabilities.canTest ? (
            <SourceConfigTestControl
              running={testing}
              disabled={anyActionPending}
              onTest={onTest}
              {...(testResult ? { result: testResult } : {})}
            />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
