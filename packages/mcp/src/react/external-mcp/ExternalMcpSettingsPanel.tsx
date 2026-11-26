import { useState, type ComponentType, type ComponentProps, type RefObject } from "react";
import type { AdminToolRefusalReason } from "@jini-ai/core/contracts/hosted-mcp";
import type { Translate } from "@jini-ai/core/text";
import { buildAllowWritePatch, resolveExternalMcpCardHandles, type useSavedAllowedToolNamesById } from "./ExternalMcpSettingsPanel.hooks.js";
import { ExternalMcpAdmissionsBanner } from "./ExternalMcpAdmissionsBanner.js";
import { ExternalMcpSourcesSection } from "./ExternalMcpSourceRow.js";
import { ExternalMcpAddFormSection, ExternalMcpRemoveConfirmSection, ExternalMcpSettingsHeader } from "./ExternalMcpPanelSections.js";

export interface ExternalMcpSettingsPanelProps {
  dependencies: { port: {
    fetchSources: () => Promise<SourceConfigItem[]>;
    addSource: (input: { fields: Record<string, string>; trust?: string }) => Promise<{ ok: boolean; source?: SourceConfigItem; message?: string }>;
    removeSource: (id: string) => Promise<boolean>;
    updateSource?: (id: string, patch: { label?: string; enabled?: boolean; fields?: Record<string, string> }) => Promise<SourceConfigItem | null>;
    testSource?: (id: string | undefined, draft?: Record<string, string>) => Promise<{ ok: boolean; message?: string; latencyMs?: number }>;
  } };
  saveStatusLabel?: string | undefined;
  showTitle?: boolean;
  hooks: {
    useTHook: () => Translate;
    useExternalMcpDriftCopyHook: () => Translate;
    useWiredSourceConfigListHook: (required: { dependencies: ExternalMcpSettingsPanelProps["dependencies"] }) => {
      sources: SourceConfigItem[]; loading: boolean; error: string | null;
      capabilities: { canRefresh: boolean; canSetTrust: boolean; canTest: boolean; canUpdate: boolean };
      testResults: Record<string, { ok: boolean; message?: string; latencyMs?: number }>;
      isPending: (id: string, kind: "add" | "remove" | "refresh" | "trust" | "test" | "update") => boolean;
      reload: () => Promise<void>; addSourceToList: (source: SourceConfigItem) => void;
      remove: (id: string) => Promise<void>; refresh: (id: string) => Promise<void>;
      setTrust: (id: string, trust: string) => Promise<void>;
      test: (id: string | undefined, draft?: Record<string, string>) => Promise<void>;
      update: (id: string, patch: { label?: string; enabled?: boolean; fields?: Record<string, string> }) => Promise<void>;
    };
    useExternalMcpAddFormHook: (required: {
      dependencies: ExternalMcpSettingsPanelProps["dependencies"];
      list: ReturnType<ExternalMcpSettingsPanelProps["hooks"]["useWiredSourceConfigListHook"]>;
    }) => { formOpen: boolean; toggleForm: () => void; cancelForm: () => void; fieldSpecs: SourceFieldSpec[];
      addForm: { values: Record<string, string>; validation: { ok: boolean; issues: { field: string; message: string }[] };
        submitAttempted: boolean; submitting: boolean; submitError: string | null;
        setField: (key: string, value: string) => void; submit: () => Promise<void>; reset: () => void };
    };
    useSavedAllowedToolNamesByIdHook: typeof useSavedAllowedToolNamesById;
    useExternalMcpAdmissionsHook: (saved: ReturnType<typeof useSavedAllowedToolNamesById<SourceConfigItem, "stdio" | "streamable_http">>) => ComponentProps<typeof ExternalMcpAdmissionsBanner<AdmissionDriftConnection>>["controller"];
    useKitT: () => Translate;
    useFocusTrap: (required: { containerRef: RefObject<HTMLElement | null> }, optional?: { active?: boolean }) => void;
    useExternalMcpToolsModalEscape: (required: { onClose: () => void; useFocusTrapHook: ExternalMcpSettingsPanelProps["hooks"]["useFocusTrap"] }, optional?: Record<string, never>) => { dialogRef: RefObject<HTMLDivElement | null>; closeRef: RefObject<HTMLButtonElement | null> };
    useExternalMcpRemoveConfirm: <TCopy>(required: { name: string; isOAuth: boolean; onCancel: () => void; t?: Translate;
      buildCopy: (required: { name: string; isOAuth: boolean }, optional: { t?: Translate }) => TCopy;
      useFocusTrapHook: ExternalMcpSettingsPanelProps["hooks"]["useFocusTrap"];
    }) => { copy: TCopy; dialogRef: RefObject<HTMLDivElement | null> };
    useHostExternalMcpSharedChoice: (required: { serverId: string; onChanged: () => void }) => {
      view: { available: boolean; connections: { credentialId: string; label: string }[]; current: { credentialId: string; status: string; granted: boolean } | null } | undefined;
      error: string; pending: boolean; load: () => Promise<void>;
      chooseSaved: (required: { credentialId: string }, optional?: Record<string, never>) => Promise<void>;
      stopHere: () => Promise<void>; chooseLocal: () => Promise<void>;
    };
    useConnect: (required: { serverId: string; grant: string; onConnected: () => void }, optional: { fallbackError: string }) => {
      state: { phase: "idle"; error?: string } | { phase: "starting" } | { phase: "waiting" } | { phase: "device"; userCode: string; verificationUri: string };
      connect: (optional?: { destination?: "shared" }) => Promise<void>; cancel: () => void;
    };
  };
  kit: {
    Icon: ComponentType<{ name: "plus"; size: number }>;
    InfoTip: ComponentType<{ label: string; triggerLabel: string; agentHandle: string }>;
    SourceConfigAddForm: ComponentType<{
      fieldSpecs: SourceFieldSpec[]; values: Record<string, string>;
      validation: { ok: boolean; issues: { field: string; message: string }[] };
      submitAttempted: boolean; submitting: boolean; submitError?: string;
      onFieldChange: (key: string, value: string) => void; onSubmit: () => void;
      canTest: boolean; testing: boolean; testResult?: { ok: boolean; message?: string; latencyMs?: number };
      onTest: () => void; addLabel: string; agentHandle: string; onCancel: () => void;
    }>;
    SourceConfigItemCard: ComponentType<{
      source: SourceConfigItem; agentHandle: string; fieldSpecs: SourceFieldSpec[];
      capabilities: ReturnType<ExternalMcpSettingsPanelProps["hooks"]["useWiredSourceConfigListHook"]>["capabilities"];
      removing: boolean; refreshing: boolean; settingTrust: boolean; testing: boolean; updating: boolean;
      onRefresh: () => void; onRemove: () => void; onTest: () => void;
      onUpdate: (patch: { label?: string; enabled?: boolean; fields?: Record<string, string> }) => void;
      testResult?: { ok: boolean; message?: string; latencyMs?: number };
    }>;
    ExternalMcpSharedChoice: ComponentType<{ serverId: string; busy: boolean; signIn: () => void; onChanged: () => void; t: Translate; useExternalMcpSharedChoiceHook: ExternalMcpSettingsPanelProps["hooks"]["useHostExternalMcpSharedChoice"] }>;
    ExternalMcpToolsModal: ComponentType<{
      name: string; cardHandle: string; onClose: () => void; serverId: string; connectionEnabled: boolean;
      allowedToolNames: string | undefined; writeAllowedToolNames: string | undefined; saving: boolean;
      onSave: (fields: { allowedToolNames: string; writeAllowedToolNames: string }) => void;
      useExternalMcpToolsModalEscapeHook: ExternalMcpSettingsPanelProps["hooks"]["useExternalMcpToolsModalEscape"];
      useTHook: () => Translate; useExternalMcpDriftCopyHook: () => Translate;
      pickerCollaborators: ExternalMcpSettingsPanelProps["deps"]["pickerCollaborators"];
    }>;
    ExternalMcpRemoveConfirmDialog: ComponentType<{ name: string; isOAuth: boolean; cardHandle: string; onConfirm: () => void; onCancel: () => void; t: Translate;
      ConfirmDialog: ExternalMcpSettingsPanelProps["kit"]["ConfirmActionDialog"];
      buildCopy: ExternalMcpSettingsPanelProps["deps"]["buildExternalMcpRemoveConfirmCopy"];
      useExternalMcpRemoveConfirmHook: ExternalMcpSettingsPanelProps["hooks"]["useExternalMcpRemoveConfirm"];
      useFocusTrapHook: ExternalMcpSettingsPanelProps["hooks"]["useFocusTrap"];
    }>;
    ConfirmActionDialog: ComponentType<{
      dialogRef: RefObject<HTMLDivElement | null>; titleId: string; title: string; body: string;
      onCancel: () => void; onConfirm: () => void; cancelText: string; confirmText: string;
      cancelHandle: string; cancelAgentLabel: string; confirmHandle: string; confirmAgentLabel: string;
    }>;
  };
  deps: {
    buildExternalMcpCardHandles: (required: { sourceIds: string[] }) => string[];
    buildExternalMcpFieldSpecs: (fields: Record<string, string>, optional: { t: Translate }) => SourceFieldSpec[];
    sourceDisplayLabel: (required: { source: SourceConfigItem; fieldSpecs: SourceFieldSpec[] }) => string;
    isBuiltInExternalMcpSource: (required: { source: SourceConfigItem }) => boolean;
    externalMcpNeedsSignIn: (required: { source: SourceConfigItem }) => boolean;
    resolveExternalMcpEffectiveTransport: (fields: Record<string, string>) => "stdio" | "streamable_http";
    resolveExternalMcpEffectiveAuthMode: (fields: Record<string, string>) => "none" | "static_env" | "oauth";
    parseSavedToolNames: (required: { value: string | undefined }) => string[];
    grantWriteFieldValue: (required: { currentWriteAllowedToolNames: string | undefined; remoteName: string }) => string;
    buildExternalMcpRemoveConfirmCopy: (required: { name: string; isOAuth: boolean }, optional: { t?: Translate }) => { title: string; body: string };
    describeDriftHeadline: (required: { connections: readonly AdmissionDriftConnection[]; copy: ExternalMcpSettingsPanelProps["deps"]["driftCopy"] }) => string;
    driftCopy: {
      readonly refusal: Readonly<Record<Exclude<AdminToolRefusalReason, "not-in-operator-allowlist">, { kind: AdmissionDriftKind; key: string }>>;
      readonly refusedFallback: string; readonly notOffered: string; readonly inertWriteGrant: string; readonly stillLive: string;
      readonly notRunning: string; readonly disabledButRunning: string; readonly removedButStillRunning: string;
      readonly decryptFailed: string; readonly failedToStart: string; readonly launcherMissing: string;
      readonly restartHeadline: string; readonly noRestartHeadline: string; readonly needsSignIn: string;
    };
    pickerCollaborators: {
      useExternalMcpDriftCopyHook: () => Translate; useTHook: () => Translate;
      productVars: Readonly<{ productName: string }>;
      useWiredExternalMcpToolPickerHook: (required: { serverId: string; active: boolean; allowedToolNames: string | undefined; writeAllowedToolNames: string | undefined; t: Translate }) => {
        readonly loading: boolean; readonly refreshing: boolean; readonly unreachable: string | null; readonly rows: readonly ToolPickerRow[];
        readonly advertisedCount: number; readonly enabledCount: number; readonly dirty: boolean;
        setEnabled: (remoteName: string, enabled: boolean) => void; setMayWrite: (remoteName: string, mayWrite: boolean) => void;
        reset: () => void; refresh: () => void; fieldValues: () => { allowedToolNames: string; writeAllowedToolNames: string };
      };
      useToolRowHandlesHook: (required: { base: string; rows: readonly ToolPickerRow[] }, optional?: Record<string, never>) => string[];
      useToolPickerFilterHook: (rows: readonly ToolPickerRow[], deps: { handles: readonly string[]; base: string; setEnabled: (remoteName: string, enabled: boolean) => void }) => {
        query: string; setQuery: (query: string) => void; visible: { row: ToolPickerRow; handle: string }[];
        canSelectAll: boolean; canSelectNone: boolean; selectVisible: (enabled: boolean) => void;
      };
    };
    EXTERNAL_MCP_PRODUCT_VARS: { productName: string };
    EXTERNAL_MCP_ADD_FORM_HANDLE: string;
  };
}

type AdmissionDriftKind = "needs-write-grant" | "destructive" | "not-offered" | "inert-write-grant" | "server-side-defect" | "still-live-after-removal" | "not-running" | "disabled-but-running" | "removed-but-still-running" | "decrypt-failed" | "failed-to-start" | "missing-launcher" | "needs-sign-in";
type AdmissionDriftConnection = {
  readonly connectionId: string; readonly notLoaded: readonly string[]; readonly liveToolCount: number; readonly savedToolCount: number;
  readonly entries: readonly { readonly connectionId: string; readonly remoteName: string | null; readonly kind: AdmissionDriftKind; readonly messageKey: string; readonly messageVars: Readonly<Record<string, string>> }[];
};
type ToolPickerRow = {
  readonly remoteName: string; readonly description: string; readonly enabled: boolean; readonly mayWrite: boolean;
  readonly writeDeclared: boolean; readonly destructiveDeclared: boolean; readonly hintsAbsent: boolean; readonly kind: "advertised" | "absent";
};

type SourceConfigItem = { id: string; label?: string; trust?: string; enabled?: boolean; fields: Record<string, string>; status?: "idle" | "testing" | "connected" | "error"; statusMessage?: string };
type SourceFieldSpec = { key: string; label: string; kind: "text" | "url" | "password" | "select" | "textarea" | "secret-textarea"; placeholder?: string; required?: boolean; options?: { value: string; label: string }[] };

/**
 * Mirrors `@jini-ai/ui`'s own `source-config-list/constants.ts`'s `DRAFT_TEST_SCOPE` — the pseudo-id
 * that feature's `useSourceConfigList().test`/`.isPending`/`.testResults` key a "test before save"
 * call on, for the add-form's still-unsaved draft. Not part of that package's public barrel (only
 * `MASK_CHAR` and its two siblings are re-exported from `constants.ts`), so it is restated here
 * rather than imported — same restatement `use-external-mcp.hooks.ts`'s own header describes for
 * `SourceUpdateInput`. Must keep matching the private constant it mirrors; `ExternalMcpTab.tsx` in
 * Jini is the source of truth for the literal value.
 */
const DRAFT_TEST_SCOPE = "__draft__";

export function ExternalMcpSettingsPanel({ dependencies, saveStatusLabel, showTitle = true, hooks, kit, deps }: ExternalMcpSettingsPanelProps, _optional = {}) {
  const { useTHook, useWiredSourceConfigListHook, useExternalMcpAddFormHook, useSavedAllowedToolNamesByIdHook, useExternalMcpAdmissionsHook, useExternalMcpDriftCopyHook } = hooks;
  const { buildExternalMcpCardHandles, resolveExternalMcpEffectiveTransport, externalMcpNeedsSignIn } = deps;
  const t = useTHook();
  // The id of the source Remove was pressed for, until Confirm or Cancel resolves it — see this
  // file's own "Remove asks first" header note. `null` means no confirmation dialog is open.
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const list = useWiredSourceConfigListHook({ dependencies });
  // The "Add server" form: open state, draft, and the lagged field-spec sync this file's header
  // describes — all owned by the hook.
  const { formOpen, toggleForm, cancelForm, fieldSpecs: addFormFieldSpecs, addForm } = useExternalMcpAddFormHook({
    dependencies,
    list,
  });
  const banner = list.error;
  const cardHandles = resolveExternalMcpCardHandles({ sources: list.sources, buildHandles: buildExternalMcpCardHandles });
  // What the RUNNING assistant admitted, as opposed to what this tab saved — two different objects,
  // because `Jini packages/mcp/src/federation/trust.ts` R5 freezes the admitted set at connect. Until this banner
  // existed the gap was visible only in the daemon's boot terminal.
  const savedAllowedToolNamesById = useSavedAllowedToolNamesByIdHook({ sources: list.sources, resolveTransport: resolveExternalMcpEffectiveTransport, needsSignIn: externalMcpNeedsSignIn });
  const admissions = useExternalMcpAdmissionsHook(savedAllowedToolNamesById);
  const tDrift = useExternalMcpDriftCopyHook();
  return <ExternalMcpSettingsPanelBody hooks={hooks} kit={kit} deps={deps} list={list} t={t} tDrift={tDrift}
    showTitle={showTitle} saveStatusLabel={saveStatusLabel} formOpen={formOpen} toggleForm={toggleForm} cancelForm={cancelForm}
    addFormFieldSpecs={addFormFieldSpecs} addForm={addForm} banner={banner} cardHandles={cardHandles} admissions={admissions}
    confirmRemoveId={confirmRemoveId} setConfirmRemoveId={setConfirmRemoveId} />;
}

type ExternalMcpPanelView = Pick<ExternalMcpSettingsPanelProps, "hooks" | "kit" | "deps" | "saveStatusLabel"> & {
  list: ReturnType<ExternalMcpSettingsPanelProps["hooks"]["useWiredSourceConfigListHook"]>;
  t: Translate; tDrift: Translate; showTitle: boolean; formOpen: boolean;
  toggleForm: () => void; cancelForm: () => void;
  addFormFieldSpecs: SourceFieldSpec[];
  addForm: ReturnType<ExternalMcpSettingsPanelProps["hooks"]["useExternalMcpAddFormHook"]>["addForm"];
  banner: string | null; cardHandles: string[];
  admissions: ReturnType<ExternalMcpSettingsPanelProps["hooks"]["useExternalMcpAdmissionsHook"]>;
  confirmRemoveId: string | null; setConfirmRemoveId: (id: string | null) => void;
};

function ExternalMcpSettingsPanelBody(props: ExternalMcpPanelView, _optional = {}) {
  const { hooks, kit, deps, list, cardHandles, t, tDrift, confirmRemoveId, setConfirmRemoveId, saveStatusLabel } = props;
  return (
    <section className="external-mcp-tab">
      {ExternalMcpPanelHead(props)}

      <ExternalMcpSourcesSection
        kit={kit} hooks={hooks} deps={deps}
        list={list}
        cardHandles={cardHandles}
        t={t}
        tDrift={tDrift}
        onRequestRemove={setConfirmRemoveId}
      />

      <ExternalMcpRemoveConfirmSection
        kit={kit} hooks={hooks} deps={deps}
        confirmRemoveId={confirmRemoveId}
        sources={list.sources}
        cardHandles={cardHandles}
        t={t}
        tDrift={tDrift}
        onConfirm={(sourceId) => {
          setConfirmRemoveId(null);
          void list.remove(sourceId);
        }}
        onCancel={() => setConfirmRemoveId(null)}
      />

      {saveStatusLabel ? (
        <div className="external-mcp-footer">
          <span className="external-mcp-save-pill">{t(saveStatusLabel)}</span>
        </div>
      ) : null}
    </section>
  );
}

function ExternalMcpPanelHead(props: ExternalMcpPanelView, _optional = {}) {
  const { kit, deps, list, t, tDrift, showTitle, formOpen, toggleForm, cancelForm, addFormFieldSpecs, addForm, banner, admissions, setConfirmRemoveId } = props;
  return <>
      <ExternalMcpSettingsHeader kit={kit} showTitle={showTitle} t={t} tDrift={tDrift} toggleForm={toggleForm} formOpen={formOpen} banner={banner} />

      <ExternalMcpAddFormSection
        kit={kit} deps={deps}
        t={t}
        open={formOpen}
        fieldSpecs={addFormFieldSpecs}
        addForm={addForm}
        canTest={list.capabilities.canTest}
        testing={list.isPending(DRAFT_TEST_SCOPE, "test")}
        testResult={list.testResults[DRAFT_TEST_SCOPE]}
        onTest={() => void list.test(undefined, addForm.values)}
        // Cancel discards the draft, not just hides it — see `useExternalMcpAddForm`'s `cancelForm`.
        onCancel={cancelForm}
      />

      <ExternalMcpAdmissionsBanner<AdmissionDriftConnection> describeHeadline={(required) => deps.describeDriftHeadline({ ...required, copy: deps.driftCopy })}
        controller={admissions}
        t={tDrift}
        onRequestRemove={setConfirmRemoveId}
        onAllowWrite={(connectionId, remoteName) => {
          const patch = buildAllowWritePatch({ sources: list.sources, connectionId, remoteName, grantWriteFieldValue: deps.grantWriteFieldValue });
          if (patch) void list.update(connectionId, patch);
        }}
      />

  </>;
}

export function bindExternalMcpSettingsPanel({ hooks, kit, deps }: Pick<ExternalMcpSettingsPanelProps, "hooks" | "kit" | "deps">, _optional = {}) {
  return function BoundExternalMcpSettingsPanel(props: Omit<ExternalMcpSettingsPanelProps, "hooks" | "kit" | "deps">, _optional = {}) {
    return <ExternalMcpSettingsPanel {...props} kit={kit} deps={deps} hooks={hooks} />;
  };
}
