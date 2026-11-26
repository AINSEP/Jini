import type { ExternalMcpSettingsPanelProps } from "./ExternalMcpSettingsPanel.js";
import type { Translate } from "@jini-ai/core/text";
type SourceConfigItem = Awaited<ReturnType<ExternalMcpSettingsPanelProps["dependencies"]["port"]["fetchSources"]>>[number];
type SourceFieldSpec = ReturnType<ExternalMcpSettingsPanelProps["deps"]["buildExternalMcpFieldSpecs"]>[number];
type SourceConfigList = ReturnType<ExternalMcpSettingsPanelProps["hooks"]["useWiredSourceConfigListHook"]>;

/** The "Add server" form, split out from `ExternalMcpSettingsPanel` purely to keep that
 *  component's own cognitive complexity under the gate — same conditional rendering, same two
 *  presence-only prop spreads (`submitError`, the draft's own `testResult`), just out of the
 *  parent's nesting scope. `null` while the form is closed, same as the inline ternary it replaces. */
export function ExternalMcpAddFormSection(props: {
  kit: ExternalMcpSettingsPanelProps["kit"]; deps: ExternalMcpSettingsPanelProps["deps"];
  t: (key: string) => string;
  open: boolean;
  fieldSpecs: SourceFieldSpec[];
  addForm: ReturnType<ExternalMcpSettingsPanelProps["hooks"]["useExternalMcpAddFormHook"]>["addForm"];
  canTest: boolean;
  testing: boolean;
  testResult: SourceConfigList["testResults"][string] | undefined;
  onTest: () => void;
  onCancel: () => void;
}, _optional = {}) {
  const { SourceConfigAddForm } = props.kit;
  const { EXTERNAL_MCP_ADD_FORM_HANDLE } = props.deps;
  if (!props.open) return null;
  const { t, fieldSpecs, addForm, canTest, testing, testResult, onTest, onCancel } = props;
  return (
    <SourceConfigAddForm
      fieldSpecs={fieldSpecs}
      values={addForm.values}
      validation={addForm.validation}
      submitAttempted={addForm.submitAttempted}
      submitting={addForm.submitting}
      {...(addForm.submitError ? { submitError: addForm.submitError } : {})}
      onFieldChange={addForm.setField}
      onSubmit={() => void addForm.submit()}
      canTest={canTest}
      testing={testing}
      {...(testResult ? { testResult } : {})}
      onTest={onTest}
      addLabel="Add server"
      agentHandle={EXTERNAL_MCP_ADD_FORM_HANDLE}
      onCancel={onCancel}
    />
  );
}



/** The remove-confirmation dialog, split out for the same complexity-budget reason as
 *  {@link ExternalMcpAddFormSection}/{@link ExternalMcpSourcesSection} above. Renders nothing until
 *  `confirmRemoveId` names a still-configured source — cleared (by the panel) the instant Confirm
 *  or Cancel resolves, so a stale id from a source removed some other way (e.g. a second tab)
 *  degrades to "no dialog" rather than throwing on a missing source. */
export function ExternalMcpRemoveConfirmSection(props: {
  kit: ExternalMcpSettingsPanelProps["kit"]; hooks: ExternalMcpSettingsPanelProps["hooks"]; deps: ExternalMcpSettingsPanelProps["deps"];
  confirmRemoveId: string | null;
  sources: readonly SourceConfigItem[];
  cardHandles: string[];
  t: Translate;
  tDrift: Translate;
  onConfirm: (sourceId: string) => void;
  onCancel: () => void;
}, _optional = {}) {
  const { ExternalMcpRemoveConfirmDialog } = props.kit;
  const { sourceDisplayLabel, buildExternalMcpFieldSpecs, resolveExternalMcpEffectiveAuthMode } = props.deps;
  const { confirmRemoveId, sources, cardHandles, tDrift, onConfirm, onCancel } = props;
  if (confirmRemoveId === null) return null;
  const index = sources.findIndex((source) => source.id === confirmRemoveId);
  if (index === -1) return null;
  const source = sources[index]!;

  return (
    <ExternalMcpRemoveConfirmDialog
      name={sourceDisplayLabel({ source, fieldSpecs: buildExternalMcpFieldSpecs(source.fields, { t: tDrift }) })}
      isOAuth={resolveExternalMcpEffectiveAuthMode(source.fields) === "oauth"}
      cardHandle={cardHandles[index]!}
      onConfirm={() => onConfirm(source.id)}
      onCancel={onCancel}
      t={tDrift}
      ConfirmDialog={props.kit.ConfirmActionDialog}
      buildCopy={props.deps.buildExternalMcpRemoveConfirmCopy}
      useExternalMcpRemoveConfirmHook={props.hooks.useExternalMcpRemoveConfirm}
      useFocusTrapHook={props.hooks.useFocusTrap}
    />
  );
}


export function ExternalMcpSettingsHeader({ kit, showTitle, t, tDrift, toggleForm, formOpen, banner }: {
  kit: ExternalMcpSettingsPanelProps["kit"];
  showTitle: boolean; t: Translate; tDrift: Translate;
  toggleForm: ReturnType<ExternalMcpSettingsPanelProps["hooks"]["useExternalMcpAddFormHook"]>['toggleForm']; formOpen: boolean;
  banner: SourceConfigList['error'];
}, _optional = {}) {
  const { Icon } = kit;
  return <>
      <div className="external-mcp-head">
        <div>
          {showTitle ? <h3>{t("External MCP servers")}</h3> : null}
          {/* i18n sweep 2026-09-22: this string has no key anywhere in `@jini-ai/ui`'s own
              `SETTINGS_DIALOG_DICTIONARIES` (what `t` above resolves against via the nearest
              `I18nProvider` in `Providers.tsx`), so it rendered English in every locale. It is
              this file's own copy, not the package's, so it now reads through `tDrift`
              (`external-mcp-i18n.ts`'s `EXTERNAL_MCP_DICT`, which carries all 21 translations)
              instead of the package's translator. */}
          <p className="external-mcp-subtitle">{tDrift("Third-party tools for your coding agent.")}</p>
        </div>
        <button
          type="button"
          className="external-mcp-add-button"
          onClick={toggleForm}
          aria-expanded={formOpen}
        >
          <Icon name="plus" size={14} />
          <span>{t("Add server")}</span>
        </button>
      </div>

      {banner ? (
        <div className="external-mcp-banner" role="alert">
          {t(banner)}
        </div>
      ) : null}
  </>;
}
