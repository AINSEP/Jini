// Assembled "External MCP servers" tab: OD as an MCP *client*. Built on top
// of `features/source-config-list`'s generic `SourceConfigList` primitive
// rather than mounting `SourceConfigListView` directly, because that view
// renders its add-form unconditionally inline — OD's own chrome hides the
// form behind an "Add server" button until clicked (see
// `od-settings-external-mcp.png` vs `od-settings-external-mcp-customform.png`
// in the parity handoff screenshots), which the generic view has no prop for.
// This file wires the same two feature hooks
// (`useWiredSourceConfigList`/`useWiredSourceConfigAddForm`) itself and adds
// the header/toggle/footer chrome around them instead.
//
// Known, disclosed gap versus the OD reference: the origin add-server form
// also has a "Display name (optional)" field and a "Need help? Map your MCP
// JSON config" collapsible. Neither is part of the generic primitive's
// contract — `AddSourceInput` has no `label`, and the collapsible is
// MCP-transport-specific presentation, not a generic field kind (see
// `source-config-list`'s own source-map notes). A host wanting either
// composes it locally; this file doesn't fabricate them.
import { useState } from 'react';
import { DRAFT_TEST_SCOPE } from '../../../source-config-list/constants.js';
import type { SourceConfigDependencies } from '../../../source-config-list/ports.js';
import type { SourceConfigItem, SourceFieldSpec } from '../../../source-config-list/types.js';
import { Icon } from '../../../../react/components/Icon.js';
import { useT } from '../../../i18n/index.js';
import { SourceConfigAddForm } from '../../../source-config-list/react/components/SourceConfigAddForm.js';
import { SourceConfigItemCard } from '../../../source-config-list/react/components/SourceConfigItemCard.js';
import { useWiredSourceConfigAddForm } from '../../../source-config-list/react/hooks/useSourceConfigAddForm.js';
import { useWiredSourceConfigList } from '../../../source-config-list/react/hooks/useSourceConfigList.js';
import { MCP_SOURCE_FIELD_SPECS } from '../../constants.js';

export interface ExternalMcpTabProps {
  /** Host-supplied transport adapter — required, same as the generic primitive (no zero-config default is possible for an arbitrary `addSource`). */
  dependencies: SourceConfigDependencies<SourceConfigItem>;
  /** Defaults to the MCP-server shape (id/transport/command/args/env). Override only for a genuinely different source shape. */
  fieldSpecs?: readonly SourceFieldSpec[];
  /** Static/real connection-error banner text (e.g. "can't reach the local daemon"). `null`/omitted renders no banner. Takes a back seat to a real `fetchSources` failure, which always wins when both are present. */
  connectionError?: string | null;
  /** Footer save-status pill text (e.g. "All changes saved"). Omit to render no footer at all. */
  saveStatusLabel?: string;
  /** Footer "Stored at <path>" text. Shown only when `saveStatusLabel` is also given, matching the footer being one unit in the OD reference. */
  configPath?: string;
}

/**
 * OD as an MCP *client* — distinct from the "MCP server" tab, where the host
 * is the one being connected to. Renders the add-form collapsed by default
 * (OD's own default state); "Add server" reveals it. Presentational
 * composition only: every list/add mutation is the two source-config-list
 * hooks' own, already-tested logic.
 */
export function ExternalMcpTab({
  dependencies,
  fieldSpecs = MCP_SOURCE_FIELD_SPECS,
  connectionError = null,
  saveStatusLabel,
  configPath,
}: ExternalMcpTabProps) {
  const t = useT();
  const [formOpen, setFormOpen] = useState(false);
  const list = useWiredSourceConfigList<SourceConfigItem>({ dependencies });
  const addForm = useWiredSourceConfigAddForm<SourceConfigItem>({
    dependencies,
    fieldSpecs,
    onAdded: (source) => {
      list.addSourceToList(source);
      setFormOpen(false);
    },
  });
  // A real load failure always wins over the host's static/decorative banner
  // text — showing both would just be two banners saying overlapping things.
  const banner = list.error ?? connectionError;

  return (
    <section className="external-mcp-tab">
      <div className="external-mcp-head">
        <div>
          <h3>{t('External MCP servers')}</h3>
          <p className="external-mcp-subtitle">{t('Third-party tools for your coding agent.')}</p>
        </div>
        <button
          type="button"
          className="external-mcp-add-button"
          onClick={() => setFormOpen((open) => !open)}
          aria-expanded={formOpen}
        >
          <Icon name="plus" size={14} />
          <span>{t('Add server')}</span>
        </button>
      </div>

      {banner ? (
        <div className="external-mcp-banner" role="alert">
          {t(banner)}
        </div>
      ) : null}

      {formOpen ? (
        <SourceConfigAddForm
          fieldSpecs={fieldSpecs}
          values={addForm.values}
          validation={addForm.validation}
          submitAttempted={addForm.submitAttempted}
          submitting={addForm.submitting}
          {...(addForm.submitError ? { submitError: addForm.submitError } : {})}
          onFieldChange={addForm.setField}
          onTrustChange={addForm.setTrust}
          onSubmit={() => void addForm.submit()}
          canTest={list.capabilities.canTest}
          testing={list.isPending(DRAFT_TEST_SCOPE, 'test')}
          {...(list.testResults[DRAFT_TEST_SCOPE] ? { testResult: list.testResults[DRAFT_TEST_SCOPE] } : {})}
          onTest={() => void list.test(undefined, addForm.values)}
          addLabel="Add server"
        />
      ) : null}

      {list.loading ? (
        <div className="source-config-list-loading" role="status">
          {t('Loading…')}
        </div>
      ) : list.sources.length === 0 ? (
        <div className="external-mcp-empty">
          <p className="external-mcp-empty-title">{t('No MCP servers configured.')}</p>
          <p className="external-mcp-empty-hint">
            {t('Click "Add server" to get started — pick a template or set up a custom stdio / HTTP server.')}
          </p>
        </div>
      ) : (
        <div className="source-config-list-items">
          {list.sources.map((source) => (
            <SourceConfigItemCard
              key={source.id}
              source={source}
              fieldSpecs={fieldSpecs}
              capabilities={list.capabilities}
              removing={list.isPending(source.id, 'remove')}
              refreshing={list.isPending(source.id, 'refresh')}
              settingTrust={list.isPending(source.id, 'trust')}
              testing={list.isPending(source.id, 'test')}
              updating={list.isPending(source.id, 'update')}
              onRefresh={() => void list.refresh(source.id)}
              onRemove={() => void list.remove(source.id)}
              onTrustChange={(trust) => void list.setTrust(source.id, trust)}
              onTest={() => void list.test(source.id)}
              onUpdate={(patch) => void list.update(source.id, patch)}
              {...(list.testResults[source.id] ? { testResult: list.testResults[source.id] } : {})}
            />
          ))}
        </div>
      )}

      {saveStatusLabel ? (
        <div className="external-mcp-footer">
          <span className="external-mcp-save-pill">{t(saveStatusLabel)}</span>
          {configPath ? (
            <span className="external-mcp-stored-at">
              {t('Stored at')} <code>{configPath}</code>
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
