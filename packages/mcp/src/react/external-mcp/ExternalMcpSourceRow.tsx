import { useState } from "react";
import { agentHandle } from "@jini-ai/core/agent-handles";
import type { ExternalMcpSettingsPanelProps } from "./ExternalMcpSettingsPanel.js";
import type { Translate } from "@jini-ai/core/text";
type SourceConfigItem = Awaited<ReturnType<ExternalMcpSettingsPanelProps["dependencies"]["port"]["fetchSources"]>>[number];
type SourceFieldSpec = ReturnType<ExternalMcpSettingsPanelProps["deps"]["buildExternalMcpFieldSpecs"]>[number];
type SourceConfigList = ReturnType<ExternalMcpSettingsPanelProps["hooks"]["useWiredSourceConfigListHook"]>;

/** The unmodified `SourceConfigItemCard`, exactly as it rendered before the Connection/Tools tab
 *  split ever existed (and still does — see this file's "Per-server Tools modal" header, the modal
 *  replaced the TABS, not this card). Split into its own component so its `testResult`
 *  presence-spread is not a conditional expression NESTED inside {@link ExternalMcpSourceRow}'s own
 *  JSX — `sonarjs/no-nested-conditional`'s complaint about the shape, not about anything the values
 *  do. */
export function ExternalMcpConnectionCard({ hooks, kit, deps, ...props }: {
  hooks: ExternalMcpSettingsPanelProps["hooks"]; kit: ExternalMcpSettingsPanelProps["kit"]; deps: ExternalMcpSettingsPanelProps["deps"];
  source: SourceConfigItem;
  cardHandle: string;
  fieldSpecs: SourceFieldSpec[];
  list: SourceConfigList;
  onRequestRemove: (sourceId: string) => void;
}, _optional = {}) {
  const { useExternalMcpDriftCopyHook } = hooks;
  const { SourceConfigItemCard } = kit;
  const { isBuiltInExternalMcpSource } = deps;
  const { source, cardHandle, fieldSpecs, list, onRequestRemove } = props;
  const testResult = list.testResults[source.id];
  const tBuiltIn = useExternalMcpDriftCopyHook();
  if (isBuiltInExternalMcpSource({ source })) {
    return <ExternalMcpBuiltInCard source={source} cardHandle={cardHandle} fieldSpecs={fieldSpecs} list={list} tBuiltIn={tBuiltIn} kit={kit} deps={deps} />;
  }
  return (
    <SourceConfigItemCard
      source={source}
      agentHandle={cardHandle}
      fieldSpecs={fieldSpecs}
      capabilities={list.capabilities}
      removing={list.isPending(source.id, "remove")}
      refreshing={list.isPending(source.id, "refresh")}
      settingTrust={list.isPending(source.id, "trust")}
      testing={list.isPending(source.id, "test")}
      updating={list.isPending(source.id, "update")}
      onRefresh={() => void list.refresh(source.id)}
      onRemove={() => onRequestRemove(source.id)}
      onTest={() => void list.test(source.id)}
      onUpdate={(patch) => void list.update(source.id, patch)}
      {...(testResult ? { testResult } : {})}
    />
  );
}


function ExternalMcpBuiltInCard({ source, cardHandle, fieldSpecs, list, tBuiltIn, kit, deps }: {
  source: SourceConfigItem; cardHandle: string; fieldSpecs: SourceFieldSpec[]; list: SourceConfigList; tBuiltIn: Translate;
  kit: ExternalMcpSettingsPanelProps["kit"]; deps: ExternalMcpSettingsPanelProps["deps"];
}, _optional = {}) {
  const { InfoTip } = kit;
  const { sourceDisplayLabel, EXTERNAL_MCP_PRODUCT_VARS } = deps;
    // Same head-row shape as `SourceConfigItemCard` (toggle, name, then a small badge and ⓘ), minus
    // Remove and the expandable fields: a built-in connection is the host's, not the operator's.
    const label = sourceDisplayLabel({ source, fieldSpecs });
    const enableLabel = tBuiltIn("Enable {name}").replace("{name}", () => label);
    return (
      <div className="source-config-item-card external-mcp-builtin-card" role="region" aria-label={label} {...agentHandle({ handle: cardHandle }, { role: "region", label })}>
        <div className="source-config-item-card-head">
          <label className="source-config-item-card-enabled-toggle" title={enableLabel}>
            <input type="checkbox" aria-label={enableLabel} {...agentHandle({ handle: `${cardHandle}-enabled` }, { role: "checkbox", label: enableLabel })} checked={source.enabled} disabled={list.isPending(source.id, "update")} onChange={(event) => void list.update(source.id, { enabled: event.target.checked })} />
          </label>
          <span className="external-mcp-builtin-summary">
            <span className="source-config-item-card-label">{label}</span>
            <span className="external-mcp-builtin-badge">{tBuiltIn("Built-in")}</span>
            <InfoTip
              label={tBuiltIn("Lets this site's assistant list your other {productName} sites, add a site pointer, and reveal a site folder.").replace("{productName}", () => EXTERNAL_MCP_PRODUCT_VARS.productName)}
              triggerLabel={tBuiltIn("About {name}").replace("{name}", () => label)}
              agentHandle={`${cardHandle}-info`}
            />
          </span>
        </div>
      </div>
    );
}

/** The "Connect" button for an OAuth row that isn't signed in (2026-10-23). It disappears once the
 *  roster re-reads the row as `connected` — see Jini's `useExternalMcpOAuthConnect` for the flow. While a
 *  sign-in is in flight it stays put, disabled, with the same label (no width jump); the line under
 *  the row says what it is waiting on. */
function ExternalMcpConnectButton(props: { cardHandle: string; rowLabel: string; busy: boolean; tDrift: Translate; onConnect: () => void }, _optional = {}) {
  const { cardHandle, rowLabel, busy, tDrift, onConnect } = props;
  const label = tDrift("Sign in to {name}").replace("{name}", () => rowLabel);
  return (
    <button
      type="button"
      className="external-mcp-source-connect"
      onClick={onConnect}
      disabled={busy}
      aria-label={label}
      {...agentHandle({ handle: `${cardHandle}-connect` }, { role: "button", label })}
    >
      {tDrift("Connect")}
    </button>
  );
}

/** The verification page's host, for the device-code line; the raw string if it won't parse. */
function displayHost({ uri }: { uri: string }, _options = {}): string {
  try { return new URL(uri).host; } catch { return uri; }
}

/** The line under a row while sign-in is in flight, or why it failed. `null` when there is
 *  nothing to say. */
function ExternalMcpConnectStatus(props: { state: ReturnType<ExternalMcpSettingsPanelProps["hooks"]["useConnect"]>["state"]; tDrift: Translate; onCancel: () => void }, _optional = {}) {
  const { state, tDrift, onCancel } = props;
  if (state.phase === "idle") {
    return state.error ? <p className="external-mcp-connect-status external-mcp-connect-status--error" role="alert">{state.error}</p> : null;
  }
  if (state.phase === "starting") return null;
  return (
    <p className="external-mcp-connect-status" role="status">
      {state.phase === "device" ? (
        <span>
          {tDrift("Enter this code on the sign-in page:")} <code>{state.userCode}</code>{" "}
          <a href={state.verificationUri} target="_blank" rel="noreferrer">{displayHost({ uri: state.verificationUri })}</a>
        </span>
      ) : (
        <span>{tDrift("Finish signing in in the new window.")}</span>
      )}
      <button type="button" className="external-mcp-connect-cancel" onClick={onCancel}>{tDrift("Cancel")}</button>
    </p>
  );
}

function ExternalMcpSourceRow({ hooks, kit, deps, ...props }: {
  hooks: ExternalMcpSettingsPanelProps["hooks"]; kit: ExternalMcpSettingsPanelProps["kit"]; deps: ExternalMcpSettingsPanelProps["deps"];
  source: SourceConfigItem;
  cardHandle: string;
  list: SourceConfigList;
  tDrift: Translate;
  /** Opens the remove-confirmation dialog for this source id, instead of deleting immediately —
   *  see this file's own "Remove asks first" header note. */
  onRequestRemove: (sourceId: string) => void;
}, _optional = {}) {
  const { useConnect } = hooks;
  const { ExternalMcpSharedChoice } = kit;
  const { buildExternalMcpFieldSpecs, parseSavedToolNames, sourceDisplayLabel, externalMcpNeedsSignIn } = deps;
  const { source, cardHandle, list, tDrift, onRequestRemove } = props;
  const [toolsOpen, setToolsOpen] = useState(false);
  const fieldSpecs = buildExternalMcpFieldSpecs(source.fields, { t: tDrift });
  // The SAVED count, not the picker's own draft — see this file's header on why.
  const enabledToolCount = parseSavedToolNames({ value: source.fields["allowedToolNames"] }).length;
  const rowLabel = sourceDisplayLabel({ source, fieldSpecs });
  // Idle (no listeners, no timers) for every row until its Connect is pressed.
  const signIn = useConnect(
    { serverId: source.id, grant: source.fields["oauthGrant"] ?? "", onConnected: () => void list.reload() },
    { fallbackError: tDrift("Sign-in could not start.") },
  );
  const showConnect = externalMcpNeedsSignIn({ source }) || signIn.state.phase !== "idle";

  return (
    <div className="external-mcp-source">
      <div className="external-mcp-source-row">
        <div className="external-mcp-source-card">
          <ExternalMcpConnectionCard
            source={source}
            cardHandle={cardHandle}
            fieldSpecs={fieldSpecs}
            list={list}
            onRequestRemove={onRequestRemove}
            kit={kit} hooks={hooks} deps={deps}
          />
        </div>
        {ExternalMcpSourceActions({ cardHandle, rowLabel, enabledToolCount, showConnect, signIn, tDrift, setToolsOpen })}
      </div>
      <ExternalMcpConnectStatus state={signIn.state} tDrift={tDrift} onCancel={signIn.cancel} />
      {source.fields["authMode"] === "oauth" && source.fields["transport"] !== "stdio" && <ExternalMcpSharedChoice serverId={source.id} busy={signIn.state.phase !== "idle"}
        signIn={() => void signIn.connect({ destination: "shared" })} onChanged={() => void list.reload()} t={tDrift} useExternalMcpSharedChoiceHook={hooks.useHostExternalMcpSharedChoice} />}

      {ExternalMcpSourceTools({ toolsOpen, setToolsOpen, rowLabel, cardHandle, source, list, kit, hooks, deps })}
    </div>
  );
}


function ExternalMcpSourceActions({ cardHandle, rowLabel, enabledToolCount, showConnect, signIn, tDrift, setToolsOpen }: {
  cardHandle: string; rowLabel: string; enabledToolCount: number; showConnect: boolean;
  signIn: ReturnType<ExternalMcpSettingsPanelProps["hooks"]["useConnect"]>; tDrift: Translate; setToolsOpen: (open: boolean) => void;
}, _optional = {}) {
  return <>
        {showConnect ? (
          <ExternalMcpConnectButton
            cardHandle={cardHandle}
            rowLabel={rowLabel}
            busy={signIn.state.phase !== "idle"}
            tDrift={tDrift}
            onConnect={() => void signIn.connect()}
          />
        ) : null}
        <button
          type="button"
          className="external-mcp-source-tools-open"
          onClick={() => setToolsOpen(true)}
          // A real `aria-label`, not just `agentHandle`'s own `label` (which only emits
          // `data-agent-label` — agent-facing metadata, invisible to `getByRole`/screen readers, per
          // `ToolPickerRowItem`'s own header note on the identical gap). This button's own visible
          // text is just "Tools" plus the bare count badge, which names neither the server nor what
          // the number means on its own — mirrors `SourceConfigItemCard`'s own enable-toggle
          // (`enabledLabel` set as BOTH `aria-label` and the agentHandle `label`, from `@jini-ai/ui`'s
          // own source) rather than inventing a new convention.
          aria-label={`Open tool permissions for ${rowLabel} — ${enabledToolCount} enabled`}
          {...agentHandle({ handle: `${cardHandle}-tools-open` }, {
            role: "button",
            label: `Open tool permissions for ${rowLabel} — ${enabledToolCount} enabled`,
          })}
        >
          <span>{tDrift("Tools")}</span>
          <span className="external-mcp-source-tools-count">{enabledToolCount}</span>
        </button>
  </>;
}

function ExternalMcpSourceTools({ toolsOpen, setToolsOpen, rowLabel, cardHandle, source, list, kit, hooks, deps }: {
  toolsOpen: boolean; setToolsOpen: (open: boolean) => void; rowLabel: string; cardHandle: string; source: SourceConfigItem;
  list: SourceConfigList; kit: ExternalMcpSettingsPanelProps["kit"]; hooks: ExternalMcpSettingsPanelProps["hooks"]; deps: ExternalMcpSettingsPanelProps["deps"];
}, _optional = {}) {
  const { ExternalMcpToolsModal } = kit;
  return <>
      {toolsOpen ? (
        <ExternalMcpToolsModal
          name={rowLabel}
          cardHandle={cardHandle}
          onClose={() => setToolsOpen(false)}
          serverId={source.id}
          connectionEnabled={source.enabled ?? true}
          allowedToolNames={source.fields["allowedToolNames"]}
          writeAllowedToolNames={source.fields["writeAllowedToolNames"]}
          saving={list.isPending(source.id, "update")}
          onSave={(fields) => void list.update(source.id, { fields })}
          useExternalMcpToolsModalEscapeHook={hooks.useExternalMcpToolsModalEscape}
          useTHook={hooks.useKitT}
          useExternalMcpDriftCopyHook={hooks.useExternalMcpDriftCopyHook}
          pickerCollaborators={deps.EXTERNAL_MCP_PICKER_COLLABORATORS}
        />
      ) : null}
  </>;
}

/** The loading / empty-state / configured-server-list body, split out for the same
 *  complexity-budget reason as {@link ExternalMcpAddFormSection} above — the triple-branch
 *  loading/empty/list ternary was the parent's deepest nesting. Each configured server is now one
 *  {@link ExternalMcpSourceRow}, which owns the per-card `testResult` presence-spread and its own
 *  Tools-modal-open state. */
export function ExternalMcpSourcesSection(props: {
  hooks: ExternalMcpSettingsPanelProps["hooks"]; kit: ExternalMcpSettingsPanelProps["kit"]; deps: ExternalMcpSettingsPanelProps["deps"];
  list: SourceConfigList;
  cardHandles: string[];
  t: Translate;
  tDrift: Translate;
  /** Opens the remove-confirmation dialog for this source id, instead of deleting immediately —
   *  see this file's own "Remove asks first" header note. */
  onRequestRemove: (sourceId: string) => void;
}, _optional = {}) {
  const { list, cardHandles, t, tDrift, onRequestRemove } = props;

  if (list.loading) {
    return (
      <div className="source-config-list-loading" role="status">
        {t("Loading…")}
      </div>
    );
  }

  if (list.sources.length === 0) {
    return (
      <div className="external-mcp-empty">
        <p className="external-mcp-empty-title">{t("No MCP servers configured.")}</p>
        <p className="external-mcp-empty-hint">
          {t('Click "Add server" to get started — pick a local command or a hosted server.')}
        </p>
      </div>
    );
  }

  return (
    <div className="source-config-list-items">
      {list.sources.map((source, index) => (
        <ExternalMcpSourceRow
          kit={props.kit} hooks={props.hooks} deps={props.deps}
          key={source.id}
          source={source}
          cardHandle={cardHandles[index]!}
          list={list}
          tDrift={tDrift}
          onRequestRemove={onRequestRemove}
        />
      ))}
    </div>
  );
}
