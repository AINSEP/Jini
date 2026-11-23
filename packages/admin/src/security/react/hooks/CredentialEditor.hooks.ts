import { CATEGORIES, sharedKeyRotationWarning } from '../../rules.js';
import { englishSecurity, type SecurityTranslator } from '../../messages.en.js';
import type { CredentialDraft, CredentialCategory, CredentialSummary } from '../../models.js';
import type { createAccessTokensController } from '../../controllers/access-tokens.controller.js';
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
export function useCredentialEditor({ controller, draft, saving, t = englishSecurity }: CredentialEditorProps, _optional = {}) {
  const provider = controller?.getSnapshot().providers.find(p => p.kind === draft.kind && p.id === draft.providerId);
  const fields = (provider?.fields ?? []).filter(f => f.name !== provider?.tokenField).map(field => ({ ...field, value: draft.values[field.name] ?? '', onValueChange({ value }: { value: string }) { controller?.setDraft({ patch: { values: { ...draft.values, [field.name]: value } } }); } }));
  return { categories: CATEGORIES.slice(1), fields, tokenLabel: provider?.fields.find(f => f.name === provider.tokenField)?.label ?? 'Access token', title: draft.id ? 'Edit credential' : 'Add credential', saving, ...keyNotes({ controller, draft, t }),
    onLabel({ value }: { value: string }) { controller?.setDraft({ patch: { label: value } }); },
    onToken({ value }: { value: string }) { controller?.setDraft({ patch: { token: value } }); },
    onUrl({ value }: { value: string }) { controller?.setDraft({ patch: { baseUrl: value } }); },
    onUsername({ value }: { value: string }) { controller?.setDraft({ patch: { username: value } }); },
    onHosts({ value }: { value: string }) { controller?.setDraft({ patch: { additionalHosts: value } }); },
    onCategory({ value }: { value: string }) { controller?.setDraft({ patch: { category: value as CredentialCategory } }); },
    save() { void controller?.save({}); }, cancel() { controller?.cancel({}); },
  };
}
