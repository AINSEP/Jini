import { CATEGORIES } from '../../rules.js';
import type { CredentialDraft, CredentialCategory } from '../../models.js';
import type { createAccessTokensController } from '../../controllers/access-tokens.controller.js';
export interface CredentialEditorProps { readonly controller: ReturnType<typeof createAccessTokensController> | null; readonly draft: CredentialDraft; readonly saving: boolean }
export function useCredentialEditor({ controller, draft, saving }: CredentialEditorProps, _optional = {}) {
  const provider = controller?.getSnapshot().providers.find(p => p.kind === draft.kind && p.id === draft.providerId);
  const fields = (provider?.fields ?? []).filter(f => f.name !== provider?.tokenField).map(field => ({ ...field, value: draft.values[field.name] ?? '', onValueChange({ value }: { value: string }) { controller?.setDraft({ patch: { values: { ...draft.values, [field.name]: value } } }); } }));
  return { categories: CATEGORIES.slice(1), fields, tokenLabel: provider?.fields.find(f => f.name === provider.tokenField)?.label ?? 'Access token', title: draft.id ? 'Edit credential' : 'Add credential', saving,
    onLabel({ value }: { value: string }) { controller?.setDraft({ patch: { label: value } }); },
    onToken({ value }: { value: string }) { controller?.setDraft({ patch: { token: value } }); },
    onUrl({ value }: { value: string }) { controller?.setDraft({ patch: { baseUrl: value } }); },
    onUsername({ value }: { value: string }) { controller?.setDraft({ patch: { username: value } }); },
    onHosts({ value }: { value: string }) { controller?.setDraft({ patch: { additionalHosts: value } }); },
    onCategory({ value }: { value: string }) { controller?.setDraft({ patch: { category: value as CredentialCategory } }); },
    save() { void controller?.save({}); }, cancel() { controller?.cancel({}); },
  };
}
