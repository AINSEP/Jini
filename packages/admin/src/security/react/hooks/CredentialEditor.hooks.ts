import { CATEGORIES, sharedKeyRotationWarning } from '../../rules.js';
import { fieldsAroundToken, invalidAdditionalHosts, worksForChoices } from '../../credential-forms.rules.js';
import { englishSecurity, type SecurityTranslator } from '../../messages.en.js';
import type { CredentialDraft, CredentialCategory, CredentialField, CredentialProvider, CredentialSummary } from '../../models.js';
import type { createAccessTokensController } from '../../controllers/access-tokens.controller.js';
import type { SecurityChipFieldProps } from '../components/chip-field.js';
type AccessController = ReturnType<typeof createAccessTokensController>;
export interface CredentialEditorProps { readonly controller: AccessController | null; readonly draft: CredentialDraft; readonly saving: boolean; readonly t?: SecurityTranslator }
/** SEC-12: the rotation warning for a project key other sites use, and where a new custom key will be stored. */
function keyNotes({ controller, draft, t }: { controller: AccessController | null; draft: CredentialDraft; t: SecurityTranslator }, _optional = {}) {
  const s = controller?.getSnapshot();
  return { rotationWarning: rotationNote({ rows: s?.rows ?? [], draft, t }), storage: storageNote({ available: s?.projectKeysAvailable ?? null, draft, t }) };
}
function rotationNote({ rows, draft, t }: { rows: readonly CredentialSummary[]; draft: CredentialDraft; t: SecurityTranslator }, _optional = {}) {
  const saved = draft.id ? rows.find(r => r.kind === draft.kind && r.id === draft.id) : undefined;
  return saved ? sharedKeyRotationWarning({ row: saved }, { t }) : null;
}
/** Only a new custom key states where it is stored, and only when the store said whether project keys exist. */
function storageNote({ available, draft, t }: { available: boolean | null; draft: CredentialDraft; t: SecurityTranslator }, _optional = {}) {
  if (draft.kind !== 'custom' || draft.id || available === null) return null;
  return t(available ? 'keyStorageProject' : 'keyThisSiteOnly');
}
function fieldViews({ fields, controller, draft }: { fields: readonly CredentialField[]; controller: AccessController | null; draft: CredentialDraft }, _optional = {}) {
  return fields.map(field => ({ ...field, value: draft.values[field.name] ?? '', onValueChange({ value }: { value: string }) { controller?.setDraft({ patch: { values: { ...draft.values, [field.name]: value } } }); } }));
}
/** SEC-10: the provider's extra fields around the token (declared order), its token label and its scope guidance. */
function providerForm({ provider, controller, draft, t }: { provider: CredentialProvider | undefined; controller: AccessController | null; draft: CredentialDraft; t: SecurityTranslator }, _optional = {}) {
  const { before, after } = provider ? fieldsAroundToken({ provider }) : { before: [], after: [] };
  return { fieldsBefore: fieldViews({ fields: before, controller, draft }), fieldsAfter: fieldViews({ fields: after, controller, draft }),
    tokenLabel: provider?.fields.find(f => f.name === provider.tokenField)?.label ?? 'Access token',
    guidance: provider?.help ? { summary: t('tokenScopeGuidance'), text: provider.help } : null };
}
/** SEC-10/11: publish and custom credentials say which plugins they serve; source control has no such list. */
function worksForField({ controller, draft, t }: { controller: AccessController | null; draft: CredentialDraft; t: SecurityTranslator }, _optional = {}): SecurityChipFieldProps | null {
  if (draft.kind === 'source-control') return null;
  const value = [...(draft.worksFor ?? [])];
  return { multiple: true, label: t('worksFor'), value, options: worksForChoices({ providers: controller?.getSnapshot().providers ?? [], value }),
    onChange(next: string[]) { controller?.setDraft({ patch: { worksFor: next } }); } };
}
function hostsError({ draft, t }: { draft: CredentialDraft; t: SecurityTranslator }, _optional = {}) {
  return draft.kind === 'custom' && invalidAdditionalHosts({ raw: draft.additionalHosts }).length > 0 ? t('additionalHostsInvalid') : null;
}
export function useCredentialEditor({ controller, draft, saving, t = englishSecurity }: CredentialEditorProps, _optional = {}) {
  const provider = controller?.getSnapshot().providers.find(p => p.kind === draft.kind && p.id === draft.providerId);
  return { categories: CATEGORIES.slice(1), ...providerForm({ provider, controller, draft, t }), title: draft.id ? 'Edit credential' : 'Add credential', saving, ...keyNotes({ controller, draft, t }),
    worksFor: worksForField({ controller, draft, t }), hostsError: hostsError({ draft, t }),
    // An edit with nothing changed has no diff to send, so Save waits for a change.
    canSave: controller?.hasChanges({}) ?? !draft.id,
    onLabel({ value }: { value: string }) { controller?.setDraft({ patch: { label: value } }); },
    onToken({ value }: { value: string }) { controller?.setDraft({ patch: { token: value } }); },
    onUrl({ value }: { value: string }) { controller?.setDraft({ patch: { baseUrl: value } }); },
    onUsername({ value }: { value: string }) { controller?.setDraft({ patch: { username: value } }); },
    onHosts({ value }: { value: string }) { controller?.setDraft({ patch: { additionalHosts: value } }); },
    onCategory({ value }: { value: string }) { controller?.setDraft({ patch: { category: value as CredentialCategory } }); },
    save() { void controller?.save({}); }, cancel() { controller?.cancel({}); },
  };
}
