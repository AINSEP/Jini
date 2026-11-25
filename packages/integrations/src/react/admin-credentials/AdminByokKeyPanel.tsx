import { agentHandle } from "@jini-ai/core/agent-handles";
import type { AgentElementRole } from "@jini-ai/core/agent-handles";

type Empty = Record<string, never>;
type AdminByokSaveState = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "error"; message: string };
interface AdminExecutionCredentialController {
  legacyKey: string | null;
  saveState: AdminByokSaveState;
  migrateLegacyKey: () => Promise<void>;
  dismissLegacyPrompt: () => void;
  canSaveKey: boolean;
  stored: { isSet: boolean } | null;
  storedKeyIsForOtherEndpoint: boolean;
  saveKey: () => Promise<void>;
  settingsSaveState: AdminByokSaveState;
  saveSettings: () => Promise<void>;
}

/**
 * @file The three small pieces `SettingsUi.tsx`'s Execution tab and `AiAssistant.tsx`'s
 * `AdminExecutionMode` both mount around `ExecutionTab` for the admin's own BYOK credential — the
 * migration banner, the "Save key" footer, and the "Save settings" footer. Presentational only; all
 * state and API calls live in the host credential hook, shared by both callers
 * so the two mounts render (and behave) identically rather than drifting — see that hook's own file
 * doc for why one shared implementation matters here specifically.
 *
 * `AdminByokKeyFooter`'s output is meant for `ExecutionTab`'s `apiKeyFooter` prop (directly under the
 * key field) and `AdminByokSettingsFooter`'s for its `formFooter` prop (the foot of the same card,
 * under Base URL / Max tokens / Model). Two slots because they are two buttons with two disjoint
 * jobs, and each belongs beside the fields it writes — see the hook's "One button per patch" doc.
 * `AdminByokMigrationPrompt` is a sibling of `<ExecutionTab>`, not a child of it — it has to render
 * regardless of whether BYOK mode is even selected, since an admin might be sitting in Local CLI mode
 * with a legacy key still inert in this browser's `localStorage`.
 *
 * All three take an optional pass-through `agentHandle` — the caller names the one thing
 * (`AdminByokMigrationPrompt`'s prompt, each footer's button), and the prompt derives its own
 * sub-handles from it via {@link byokAgentProps}. Omit and none renders any `data-agent-*` markup at
 * all.
 */

/** Builds one of these two components' own `data-agent-*` sub-element props, or nothing when the
 *  caller published no base handle — same local-helper shape `RowMenu.tsx` uses for its own
 *  `rowMenuAgentProps`, kept local here since only these two components need it.
 *
 * @param input.base - The component's own handle from the caller, or `undefined` when none was published.
 * @param input.action - The sub-element's name, appended to `base`.
 * @param input.options - Role and stable label for this sub-element.
 * @returns Spreadable attribute props, or `{}` when `base` is `undefined`.
 * @complexity O(1). */
function byokAgentProps({ base, action, options }: { base: string | undefined; action: string; options: { role: AgentElementRole; label: string } }, _options: Record<string, never> = {}) {
  return base === undefined ? {} : agentHandle({ handle: `${base}-${action}` }, options);
}

export interface AdminByokMigrationPromptProps {
  controller: Pick<AdminExecutionCredentialController, "legacyKey" | "saveState" | "migrateLegacyKey" | "dismissLegacyPrompt">;
  /** This prompt's own base handle — see this file's header for the derived `-save`/`-dismiss`
   *  sub-handles. Omit to leave it untagged. */
  agentHandle?: string;
  useAdminLocaleHook: () => string;
  createTranslator: (required: { locale: string }, options?: Empty) => (required: { key: string }, options?: Empty) => string;
}

/**
 * The one-time "we found a saved key in this browser — save it to your account?" prompt (owner-
 * approved rollout, design doc §6). Renders nothing once `controller.legacyKey` is `null` —
 * migrated, declined this session, or there was never a local key to find.
 *
 * @complexity Time/space: O(1) — fixed markup, no iteration.
 * @overallScore 100
 */
export function AdminByokMigrationPrompt({ controller, agentHandle: base,
  useAdminLocaleHook, createTranslator }: AdminByokMigrationPromptProps) {
  const locale = useAdminLocaleHook();
  const t = createTranslator({ locale }, {});
  if (!controller.legacyKey) return null;
  const saving = controller.saveState.status === "saving";

  return (
    <div className="notice admin-byok-migration" role="status">
      <p>
        {t({ key: "We found a saved key in this browser — save it to your account? It will be encrypted and stored on the server, and this browser's copy will be cleared once that succeeds. Declining leaves it exactly as it is; nothing is sent or cleared unless you confirm." })}
      </p>
      <div className="admin-byok-migration-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={() => void controller.migrateLegacyKey()}
          disabled={saving}
          {...byokAgentProps({ base, action: "save", options: { role: "button", label: "Save this browser's key to your account" } })}
        >
          {saving ? t({ key: "Saving…" }) : t({ key: "Save to my account" })}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={controller.dismissLegacyPrompt}
          disabled={saving}
          {...byokAgentProps({ base, action: "dismiss", options: { role: "button", label: "Dismiss this prompt without saving" } })}
        >
          {t({ key: "Not now" })}
        </button>
      </div>
      {controller.saveState.status === "error" ? <div className="save-error">{controller.saveState.message}</div> : null}
    </div>
  );
}

export interface AdminByokKeyFooterProps {
  resolveByokFooterStatusLine: (
    required: { status: AdminByokSaveState["status"]; isStored: boolean },
    options?: { storedKeyIsForOtherEndpoint?: boolean; t?: (key: string) => string },
  ) => string | null;
  controller: Pick<AdminExecutionCredentialController, "saveState" | "canSaveKey" | "stored" | "storedKeyIsForOtherEndpoint" | "saveKey">;
  /** Publishes the "Save key" button as agent-addressable via `agentHandle()` (`@jini-ai/agentic`).
   *  Omit to leave it untagged. */
  agentHandle?: string;
  /** The host screen's `t`, for the status line. Omit for English passthrough. */
  t?: (key: string) => string;
  useAdminLocaleHook: () => string;
  createTranslator: (required: { locale: string }, options?: Empty) => (required: { key: string }, options?: Empty) => string;
}

/**
 * The explicit "Save key" control and its status line — the ONLY control on either screen that
 * writes the admin's KEY. Meant for `ExecutionTab`'s `apiKeyFooter` slot, directly under the
 * API-key field. Its sibling {@link AdminByokSettingsFooter} writes the non-secret fields and
 * nothing else.
 *
 * While idle with a key stored for another endpoint (a provider switch), the line asks for this
 * provider's key rather than reporting a stored key this provider cannot use.
 *
 * @complexity Time/space: O(1).
 */
export function AdminByokKeyFooter({ controller, agentHandle: handle, t,
  useAdminLocaleHook, createTranslator, resolveByokFooterStatusLine }: AdminByokKeyFooterProps) {
  const locale = useAdminLocaleHook();
  const sharedT = createTranslator({ locale }, {});
  const { saveState, canSaveKey, stored, storedKeyIsForOtherEndpoint } = controller;
  const saving = saveState.status === "saving";
  const statusLine = resolveByokFooterStatusLine({ status: saveState.status, isStored: stored?.isSet ?? false }, { storedKeyIsForOtherEndpoint, t: t ?? ((key) => sharedT({ key })) });

  return (
    <div className="assistant-key-footer">
      <div className="assistant-key-actions">
        {/* Disabled whenever the field is blank, stored key or not: this button's only job is to
            write the key, and an empty field has no key to write. A stored key does NOT re-enable it
            — that arm is what left Save key live after someone typed a key and then cleared it.
            Never fires automatically; see the hook's own doc for why this is the ONLY path that can
            persist the key. */}
        <button
          type="button"
          className="btn-primary"
          onClick={() => void controller.saveKey()}
          disabled={!canSaveKey || saving}
          {...(handle ? agentHandle({ handle }, { role: "button", label: "Save this API key" }) : {})}
        >
          {saving ? sharedT({ key: "Saving…" }) : sharedT({ key: "Save key" })}
        </button>
      </div>
      <p className="assistant-save-line">{statusLine}</p>
      {saveState.status === "error" ? <div className="save-error">{saveState.message}</div> : null}
    </div>
  );
}

export interface AdminByokSettingsFooterProps {
  controller: Pick<AdminExecutionCredentialController, "settingsSaveState" | "saveSettings">;
  /** Publishes the "Save settings" button as agent-addressable via `agentHandle()`
   *  (`@jini-ai/agentic`). Omit to leave it untagged. */
  agentHandle?: string;
  /** The host screen's `t`, for the status line. Omit for English passthrough. */
  t?: (key: string) => string;
  useAdminLocaleHook: () => string;
  createTranslator: (required: { locale: string }, options?: Empty) => (required: { key: string }, options?: Empty) => string;
}

/**
 * {@link AdminByokSettingsFooter}'s status line, as a single string (or `null`) — the sibling of
 * {@link resolveByokFooterStatusLine}, kept as its own pure function for the same reason.
 *
 * Deliberately says "Settings saved." and never anything about encryption or the server holding a
 * key. This button sends no `apiKey`, so borrowing the key footer's "Saved to the server,
 * encrypted." would recreate — under a new button — the exact false confirmation the split exists to
 * remove.
 *
 * `error` returns `null` because the message itself is rendered separately, same division of labour
 * as the key footer.
 *
 * @param input.status - The `settingsSaveState` status this footer reports on.
 * @param options.t - The host screen's translator. Defaults to English passthrough.
 * @returns The line to render, or `null` when there is nothing to say.
 * @complexity O(1).
 */
export function resolveByokSettingsStatusLine({ status }: { status: AdminByokSaveState["status"] }, { t = (key) => key }: { t?: (key: string) => string } = {}
): string | null {
  if (status === "saving") return t("Saving…");
  if (status === "saved") return t("Settings saved.");
  return null;
}

/**
 * The explicit "Save settings" control and its status line — the ONLY control on either screen that
 * writes the credential row's protocol/providerId/base URL/model/max-tokens snapshot. Meant for
 * `ExecutionTab`'s `formFooter` slot, at the foot of the BYOK card under the fields it writes.
 *
 * Never disabled by the key field's state, only by its own in-flight save: settings are not the key,
 * and a blank key field is no reason to refuse a model change. That independence is the point of the
 * split — see the controller's `saveSettings` doc for why this button, not `saveKey`, is what keeps
 * the server-side turn-execution fallback current.
 *
 * @complexity Time/space: O(1).
 */
export function AdminByokSettingsFooter({ controller, agentHandle: handle, t,
  useAdminLocaleHook, createTranslator }: AdminByokSettingsFooterProps) {
  const locale = useAdminLocaleHook();
  const sharedT = createTranslator({ locale }, {});
  const { settingsSaveState } = controller;
  const saving = settingsSaveState.status === "saving";
  const statusLine = resolveByokSettingsStatusLine({ status: settingsSaveState.status }, { t: t ?? ((key) => sharedT({ key })) });

  return (
    <div className="assistant-settings-footer">
      <div className="assistant-key-actions">
        {/* `.btn-primary`, the same burnt-orange as Save key above (owner ruling, 2026-09-02). These
            are two halves of one job — writing a credential row — and a secondary/outline treatment
            read as "the lesser one", which is the wrong hierarchy: an admin who only ever presses
            Save key leaves the row with no model, which the server-side turn fallback treats as
            unusable. Same class, not a matching hex: `--primary` is the token. */}
        <button
          type="button"
          className="btn-primary"
          onClick={() => void controller.saveSettings()}
          disabled={saving}
          {...(handle ? agentHandle({ handle }, { role: "button", label: "Save these execution settings" }) : {})}
        >
          {saving ? sharedT({ key: "Saving…" }) : sharedT({ key: "Save settings" })}
        </button>
      </div>
      {statusLine ? <p className="assistant-save-line">{statusLine}</p> : null}
      {settingsSaveState.status === "error" ? <div className="save-error">{settingsSaveState.message}</div> : null}
    </div>
  );
}
