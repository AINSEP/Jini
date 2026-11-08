/**
 * @file A key card an installed plugin declares for its own provider (2026-10-22, starting with mail
 * providers). The generic "Save an API credential" card asks for a label, base URL, category and
 * deploy targets the person has no reason to know; a plugin that already knows them declares its own
 * card copy, and core fills the rest in on the server. The form carries a masked token plus
 * declared non-secret fields. Fixed labels, origins and categories remain server-owned, so a
 * submission cannot redirect the key to another row. Instance-specific origins are explicit fields. Core names no vendor: every word on the card comes from the plugin's descriptor.
 */
/** @agent-note `app` is the host's own id; it appears in every rendered card. */
import type { SurfaceCardSecretForm as SecretCardForm, SurfaceCardApp } from '@jini-ai/core/contracts/cards';
import type { PluginCredentialCard } from '@jini-ai/core/contracts/credentials';

/**
 * Renders a plugin's key card: its title, intro and help link above declared public fields and one masked token field.
 * The help link is a detail row (the form surface has no link control), and the saved label is
 * shown so the person can find the row later under Access Tokens.
 *
 * @complexity O(f) declared public fields; mail retains its original one-field form.
 */
export function buildPluginCredentialForm({ card, app }: { card: PluginCredentialCard; app: SurfaceCardApp }, _optional = {}): SecretCardForm & { preferredFrameSize: readonly [string, string]; description: string } {
  return {
    title: card.title,
    description: `${card.intro ? card.intro + " " : ""}The key is sealed on the server the moment you submit — the assistant never sees it.`,
    details: pluginCardDetails({ card }),
    submitLabel: "Save key",
    fields: [...(card.fields ?? []).map(field => ({ kind: "string" as const, ...field })), {
      kind: "string",
      name: "token",
      label: "API key",
      hint: card.keyHint ?? "Paste the key here. It is never shown to the assistant.",
      required: true,
      secret: true,
    }],
    app,
    preferredFrameSize: ["100%", "360px"],
  };
}

/** Apply plugin copy to an existing domain form, preserving its fields, update and blank-token rules.
 * Domain stores remain authoritative for connection validation. @complexity O(f) form fields.
 */
export function applyPluginCredentialCard({ card, form, app }: { card?: PluginCredentialCard | undefined; form: SecretCardForm; app: SurfaceCardApp }, _options = {}): SecretCardForm {
  if (!card) return form;
  const pluginForm = buildPluginCredentialForm({ card, app });
  return { ...form, title: pluginForm.title, description: form.description ? `${card.intro ?? ""} ${form.description}`.trim() : pluginForm.description, details: [...(form.details ?? []), ...(pluginForm.details ?? [])],
    fields: form.fields.map(field => field.kind === "string" && field.name === "token" && field.secret ? { ...field, ...(card.keyHint === undefined ? {} : { hint: card.keyHint }) } : field) };
}

/** API rows have a fixed label; domain owners choose their own connection identity. */
function pluginCardDetails({ card }: { card: PluginCredentialCard }, _options = {}): NonNullable<SecretCardForm['details']> {
  const help = card.helpUrl ? [{ label: card.helpLabel ?? 'Get a key', value: card.helpUrl }] : [];
  const details = [...help, ...(card.usedFor?.length ? [{ label: 'Used for', value: card.usedFor.join('; ') }] : [])];
  return card.saveKind && card.saveKind !== 'api' ? details : [...details, { label: 'Saved as', value: card.label }];
}
