import { agentHandle, type AgentHandleProps } from "@jini-ai/core/agent-handles";
import type { AdminPluginDto } from "@jini-ai/core/contracts/site/cms-plugins";
import { interpolate, type Translate } from '@jini-ai/core/text';

import { useEffect, useId, type ComponentType, type ReactNode } from "react";

/**
 * @file A provider plugin's secure settings card (2026-10-26): Plugins → Installed (or Downloaded) →
 * the plugin's Settings button. Every field comes from the plugin's manifest; secret fields are
 * password inputs that never show a saved value ("Saved — leave blank to keep"). Saved values are
 * sealed on the server (the project store visible to attached sites, or this site's vault) and
 * apply now.
 *
 * 2026-10-25 redesign (owner: "looks awful"): the admin's native domain dialog (`PostUrlDialog`'s
 * Jini `Dialog` + `.jini-dialog-body`/`.jini-dialog-footer`) with the `.field` primitives — label
 * above a full-width control, hint below — instead of bare inline labels. Titled "<Name> settings";
 * a successful Save hands off to `onSaved` (the screen closes the card and shows a toast), so the
 * outcome is never a small line inside a card the owner is about to dismiss.
 */

/** A kit action port (structural: the host injects its kit's Button/Dialog). */
type KitAction = (required: Record<string, never>, optional?: Record<string, never>) => void;

/** The Button props this dialog uses; the host's kit Button must accept at least these. */
export interface ProviderSettingsButtonProps {
  readonly children?: ReactNode; readonly onPress?: KitAction; readonly disabled?: boolean; readonly pending?: boolean;
  readonly variant?: "primary" | "secondary"; readonly type?: "submit"; readonly className?: string; readonly attrs?: AgentHandleProps;
}

/** The Dialog props this dialog uses. */
export interface ProviderSettingsDialogFrameProps {
  readonly open: boolean; readonly title: string; readonly children?: ReactNode; readonly onClose: KitAction;
  readonly pending?: boolean; readonly className?: string;
}

/** One manifest-declared provider setting, as the settings endpoint describes it. */
export interface ProviderSettingFieldShape {
  name: string; label: string; hint?: string; default?: string;
  options?: { value: string; label: string }[]; allowCustom?: true;
  secret: boolean; required: boolean;
  requiredUnless?: { readonly field: string; readonly equals: string; readonly orPresent?: string; readonly headerNames?: readonly string[] };
  requiredWhen?: { readonly field: string; readonly in: readonly string[] };
  saved: boolean; value?: string;
}

/** The provider-settings card (`GET|PUT .../plugins/:pluginId/provider-settings`). */
export interface ProviderSettingsCard {
  pluginId: string; store: "project" | "site"; appliesAt: "now" | "restart" | "failed"; message?: string;
  keyId?: string; usedByThisSite: boolean; usedBy: string[]; projectAvailable?: boolean;
  legacyCredential?: true; unreadable?: true; fields: ProviderSettingFieldShape[];
}

/** What the injected settings hook returns. */
export interface ProviderSettingsController {
  card: ProviderSettingsCard | null;
  values: Readonly<Record<string, string>>;
  setValue: (required: { name: string; value: string }, optional?: Record<string, never>) => void;
  save: () => Promise<boolean>;
  useSavedKey: () => Promise<boolean>;
  saving: boolean;
  error: string | null;
  t: Translate;
}

/** The injected field view's props. */
export interface ProviderSettingFieldViewProps {
  readonly field: ProviderSettingFieldShape; readonly id: string; readonly value: string;
  readonly onChange: (value: string) => void; readonly handle: string; readonly pluginName: string;
  readonly t: (key: string) => string;
}

/** The injected rule deciding whether a field is required given what is entered and saved. */
export type ProviderSettingRequiredHere = (required: { field: ProviderSettingFieldShape; fields: readonly ProviderSettingFieldShape[]; entered: Readonly<Record<string, string | undefined>>; values: Readonly<Record<string, string>> }, optional?: Record<string, never>) => boolean;

export interface PluginProviderSettingsDialogProps {
  readonly kit: { Button: ComponentType<ProviderSettingsButtonProps>; Dialog: ComponentType<ProviderSettingsDialogFrameProps>; ProviderSettingField: ComponentType<ProviderSettingFieldViewProps> };
  readonly providerSettingRequiredHere: ProviderSettingRequiredHere;
  readonly legacyCredentialKey: string;
  readonly useProviderSettingsFocusHook: (required: { card: ProviderSettingsCard | null; fieldId: string }) => void;
  readonly plugin: Pick<AdminPluginDto, "id" | "name">;
  readonly agentHandleBase: string;
  readonly onClose: () => void;
  /** After the server accepted the values; the screen closes the card and confirms with a notice. */
  readonly onSaved: () => void;
  /** Injectable seam for tests. Defaults to the real {@link useWiredPluginProviderSettings}. */
  readonly useSettings: (required: { pluginId: string }) => ProviderSettingsController;
}

/** Field names are manifest keys (`apiKey`); agent handles allow only lowercase words joined by hyphens. */
function handleWords({ name }: { name: string }, _options = {}): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** The card's re-entry notices (a key saved the retired way, or saved keys this machine can't open). */
function ReentryNotices({ card, t, legacyCredentialKey }: { card: ProviderSettingsCard | null; t: (key: string) => string; legacyCredentialKey: string }) {
  return (
    <>
      {card?.unreadable ? <p className="provider-settings-notice" role="note">{t("Saved keys for this plugin can't be read on this machine. Enter them again here and save.")}</p> : null}
      {card?.legacyCredential ? <p className="provider-settings-notice" role="note">{t(legacyCredentialKey)}</p> : null}
    </>
  );
}

/** Cancel and Save; disabled with a spinner while saving. */
function SettingsFooter({ shown, saving, pluginName, agentHandleBase, onClose, t, Button }: { Button: ComponentType<ProviderSettingsButtonProps>; shown: boolean; saving: boolean; pluginName: string; agentHandleBase: string; onClose: () => void; t: (key: string) => string }) {
  return (
    <div className="jini-dialog-footer">
      <Button variant="secondary" className="btn-secondary" disabled={saving} onPress={() => onClose()}
        attrs={agentHandle({ handle: `${agentHandleBase}-settings-close` }, { role: "button", label: `Close ${pluginName} settings` })}>
        {t("Cancel")}
      </Button>
      <Button type="submit" variant="primary" className="provider-settings-save" disabled={!shown} pending={saving}
        attrs={agentHandle({ handle: `${agentHandleBase}-settings-save` }, { role: "button", label: `Save ${pluginName} settings` })}>
        {saving ? <><span className="provider-settings-spinner" aria-hidden="true" />{t("Saving…")}</> : t("Save")}
      </Button>
    </div>
  );
}

/** What an empty input stands for: a saved secret counts as present, else the declared default. */
function unenteredFieldValue(field: { secret?: boolean; saved?: boolean; default?: string }): string {
  if (field.secret && field.saved) return "saved";
  return field.default ?? "";
}

function SettingsSubtitle({ card, t }: { card: ProviderSettingsCard | null; t: (key: string) => string }) {
  if (!card) return null;
  return <p className="provider-settings-subtitle">{settingsSubtitleText({ card, t })}</p>;
}

function settingsSubtitleText({ card, t }: { card: ProviderSettingsCard; t: (key: string) => string }, _options = {}): string {
  if (card.store !== "project") return t(card.projectAvailable ? "Saved for this site only" : "Saved for this site");
  if (card.usedBy.length) return interpolate({ template: t("Used by {sites}"), vars: { sites: card.usedBy.join(", ") } });
  return t("Saved to your project — not used by any site yet");
}

export function useProviderSettingsFocus({ card, fieldId, document }: { card: ProviderSettingsCard | null; fieldId: string; document: { getElementById(id: string): { focus(): void } | null } }, _options = {}) {
  // The native dialog focuses on open, before the card has loaded; once it has, start in its first field.
  const firstField = card?.fields[0]?.name;
  useEffect(() => { if (firstField) document.getElementById(`${fieldId}-${firstField}`)?.focus(); }, [fieldId, firstField]);
}

export function PluginProviderSettingsDialog({ plugin, agentHandleBase, onClose, onSaved, useSettings, useProviderSettingsFocusHook, kit, providerSettingRequiredHere, legacyCredentialKey }: PluginProviderSettingsDialogProps, _optional: Record<string, never> = {}) {
  const { Button, Dialog, ProviderSettingField } = kit;
  const { card, values, setValue, save, useSavedKey: selectSavedKey, saving, error, t } = useSettings({ pluginId: plugin.id });
  const fieldId = useId();
  const fields = card?.fields ?? [];
  // Presence only: a saved alternate secret satisfies the same manifest rule as an entered value.
  const effectiveValues = Object.fromEntries(fields.map(field => [field.name,
    values[field.name]?.trim() || unenteredFieldValue(field)]));
  useProviderSettingsFocusHook({ card, fieldId });
  return (
    <Dialog open title={interpolate({ template: t("{name} settings"), vars: { name: plugin.name } })} pending={saving} onClose={() => onClose()} className="settings-dialog jini-domain-dialog provider-settings-dialog">
      <SettingsSubtitle card={card} t={t} />
      <form onSubmit={(event) => { event.preventDefault(); void save().then((accepted) => { if (accepted) onSaved(); }); }} noValidate>
        <div className="jini-dialog-body">
          <ReentryNotices card={card} t={t} legacyCredentialKey={legacyCredentialKey} />
          {card?.store === "project" && card.keyId && !card.usedByThisSite ? <Button variant="secondary" disabled={saving}
            onPress={() => { void selectSavedKey().then(accepted => { if (accepted) onSaved(); }); }}>
            {t("Use the saved key for this site")}
          </Button> : null}
          {fields.map((field) => (
            <ProviderSettingField key={field.name} field={{ ...field, required: providerSettingRequiredHere({ field, fields, entered: values, values: effectiveValues }) }} id={`${fieldId}-${field.name}`} value={values[field.name] ?? ""}
              onChange={(value) => setValue({ name: field.name, value })} handle={`${agentHandleBase}-setting-${handleWords({ name: field.name })}`} pluginName={plugin.name} t={t} />
          ))}
        </div>
        {error ? <p className="save-error" role="alert">{error}</p> : null}
        <SettingsFooter shown={card !== null} saving={saving} pluginName={plugin.name} agentHandleBase={agentHandleBase} onClose={onClose} t={t} Button={Button} />
      </form>
    </Dialog>
  );
}
