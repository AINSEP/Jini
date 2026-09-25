import { useState } from 'react';
import { useT } from '../../../i18n/index.js';
import { sourceConfigActionHandle, sourceConfigAgentProps, sourceConfigFieldHandle } from '../../agent-handles.js';
import {
  issueForField,
  maskFieldValue,
  sourceDisplayLabel,
  validateSourceDraft,
} from '../../rules.js';
import type {
  SourceConfigItem,
  SourceFieldSpec,
  SourceFieldValues,
  SourceTestResult,
  SourceTrustOption,
  SourceUpdateInput,
} from '../../types.js';
import { SourceConfigField } from './SourceConfigField.js';
import { SourceConfigTestControl } from './SourceConfigTestControl.js';
import type { SourceConfigListCapabilities } from '../hooks/useSourceConfigList.js';

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
  /**
   * This card's own agent handle — publishes the card and every control on it
   * to `@jini-ai/agentic`'s `page.*` verbs. A plain string, not a per-element
   * map: the caller names the card, this component names its own parts and
   * supplies each one's role and label, because only it knows which of its
   * eight-or-so controls are rendered for a given `capabilities`/expansion/
   * edit state. Omit and no `data-agent-*` markup is emitted at all.
   *
   * A list renders many of these, so the caller is responsible for handing
   * each card a DISTINCT base — two cards under the same base would publish
   * duplicate handles and make every verb on them ambiguous. See the table
   * below and `../../agent-handles.ts`.
   */
  agentHandle?: string;
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
 *
 * ## Agent handles
 *
 * Given `agentHandle="mcp-server-1"` this publishes, whenever the control in
 * question is actually rendered:
 *
 * | element | handle | role |
 * |---|---|---|
 * | the card | `mcp-server-1` | `region` |
 * | enable/disable toggle | `mcp-server-1-enabled` | `checkbox` |
 * | expand/collapse summary | `mcp-server-1-expand` | `button` |
 * | trust selector | `mcp-server-1-trust` | `field` |
 * | refresh / remove | `mcp-server-1-refresh` / `-remove` | `button` |
 * | edit / save / cancel | `mcp-server-1-edit` / `-save` / `-cancel` | `button` |
 * | the label input (editing) | `mcp-server-1-label` | `field` |
 * | one field (editing) | `mcp-server-1-field-<kebab-cased key>` | `field` |
 * | the test control | `mcp-server-1-test` / `-test-status` | `button` / `status` |
 *
 * A caller reaching the edit fields has to `page.click` `-expand` and then
 * `-edit` first, and re-run `page.find_elements` after each: those controls
 * genuinely do not exist in the DOM until then, and this component owns that
 * state privately. That sequencing is the honest shape of the card, not a
 * limitation of the markup.
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
  agentHandle,
}: SourceConfigItemCardProps<TSource>) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState('');
  const [editFields, setEditFields] = useState<SourceFieldValues>({});
  /** Errors stay hidden until the operator actually tries to save, matching the add form's `submitAttempted`. */
  const [saveAttempted, setSaveAttempted] = useState(false);
  const label = sourceDisplayLabel(source, fieldSpecs);
  const trustOption = trustOptions?.find((option) => option.value === source.trust);
  const editableTrustOptions = capabilities.canSetTrust && trustOptions && trustOptions.length > 0 ? trustOptions : null;
  const anyActionPending = removing || refreshing || settingTrust || updating;

  // The SAME validation the add form runs (`useSourceConfigAddForm`). The edit
  // path used to run none at all — not even the required-field check — so a
  // source added through a validated form could be edited into a state the form
  // would have refused to create, straight through `port.updateSource`.
  const editValidation = validateSourceDraft(fieldSpecs, editFields);

  const startEditing = () => {
    setEditLabel(source.label ?? '');
    setEditFields({ ...source.fields });
    setSaveAttempted(false);
    setEditing(true);
  };
  const cancelEditing = () => {
    setSaveAttempted(false);
    setEditing(false);
  };
  const saveEditing = () => {
    setSaveAttempted(true);
    if (!editValidation.ok) return;
    onUpdate({ label: editLabel, fields: editFields });
    setSaveAttempted(false);
    setEditing(false);
  };

  const enabledLabel = t('Enable {name}', { name: label });
  const trustLabel = t('Trust level for {name}', { name: label });

  return (
    <article
      className={`source-config-item-card${expanded ? ' is-expanded' : ''}`}
      data-testid="source-config-item-card"
      {...sourceConfigAgentProps(agentHandle, { role: 'region', label })}
    >
      <div className="source-config-item-card-head">
        {source.enabled !== undefined && capabilities.canUpdate ? (
          <label className="source-config-item-card-enabled-toggle" title={source.enabled ? t('Enabled') : t('Disabled')}>
            <input
              type="checkbox"
              checked={source.enabled}
              disabled={updating}
              aria-label={enabledLabel}
              {...sourceConfigAgentProps(agentHandle, { role: 'checkbox', label: enabledLabel, action: 'enabled' })}
              onChange={(event) => onUpdate({ enabled: event.target.checked })}
            />
          </label>
        ) : null}
        <button
          type="button"
          className="source-config-item-card-summary"
          {...sourceConfigAgentProps(agentHandle, {
            role: 'button',
            // Stable ontology, so it must not read "Collapse" once expanded — see `agent-handles.ts`.
            label: t('Show or hide details for {name}', { name: label }),
            action: 'expand',
          })}
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
              aria-label={trustLabel}
              {...sourceConfigAgentProps(agentHandle, { role: 'field', label: trustLabel, action: 'trust' })}
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
            <button
              type="button"
              {...sourceConfigAgentProps(agentHandle, { role: 'button', label: t('Refresh'), action: 'refresh' })}
              onClick={onRefresh}
              disabled={anyActionPending}
            >
              {refreshing ? t('Refreshing…') : t('Refresh')}
            </button>
          ) : null}
          <button
            type="button"
            className="source-config-item-card-remove"
            {...sourceConfigAgentProps(agentHandle, { role: 'button', label: t('Remove'), action: 'remove' })}
            onClick={onRemove}
            disabled={anyActionPending}
          >
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
                  <button
                    type="button"
                    {...sourceConfigAgentProps(agentHandle, { role: 'button', label: t('Save'), action: 'save' })}
                    onClick={saveEditing}
                    disabled={updating || (saveAttempted && !editValidation.ok)}
                  >
                    {t('Save')}
                  </button>
                  <button
                    type="button"
                    {...sourceConfigAgentProps(agentHandle, { role: 'button', label: t('Cancel'), action: 'cancel' })}
                    onClick={cancelEditing}
                    disabled={updating}
                  >
                    {t('Cancel')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  {...sourceConfigAgentProps(agentHandle, { role: 'button', label: t('Edit'), action: 'edit' })}
                  onClick={startEditing}
                  disabled={anyActionPending}
                >
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
                  {...sourceConfigAgentProps(agentHandle, { role: 'field', label: t('Label'), action: 'label' })}
                  onChange={(event) => setEditLabel(event.target.value)}
                />
              </label>
              {fieldSpecs.map((spec) => {
                // Same `{label}`-template wrapping the add form uses — `rules.ts`
                // stays hook-free and returns i18n templates, not sentences.
                const issue = saveAttempted ? issueForField(editValidation, spec.key) : undefined;
                return (
                  <SourceConfigField
                    key={spec.key}
                    spec={spec}
                    value={editFields[spec.key] ?? ''}
                    idPrefix={`source-config-item-card-${source.id}-field`}
                    {...(issue ? { error: t(issue.message, { label: t(spec.label) }) } : {})}
                    {...(agentHandle ? { agentHandle: sourceConfigFieldHandle(agentHandle, spec.key) } : {})}
                    onChange={(value) => setEditFields((current) => ({ ...current, [spec.key]: value }))}
                  />
                );
              })}
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
              {...(agentHandle ? { agentHandle: sourceConfigActionHandle(agentHandle, 'test') } : {})}
            />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
