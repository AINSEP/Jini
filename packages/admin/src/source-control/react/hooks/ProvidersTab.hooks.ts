import type { TabViewProps } from '../../../core/react/bind-react.js';
import { useController } from '../../../core/react/use-controller.js';
import { createSourceControlController } from '../../controllers/source-control.controller.js';
import type { SourceControlCredential, SourceControlDraft, SourceControlField, SourceControlProviderInfo, SourceControlState } from '../../models.js';
import { blankSourceControlDraft, sourceControlProviders, defaultSourceControlCredential, sourceControlReady, safeSourceControlUrl } from '../../rules.js';
import { useSourceControlPorts } from './SourceControlPorts.hooks.js';

type SourceControlController = ReturnType<typeof createSourceControlController>;
/** Stand-in snapshot until the controller mounts: nothing listed yet, still loading. */
const UNMOUNTED: SourceControlState = { providers: [], credentials: [], drafts: {}, loading: true, loaded: false, error: null, catalogError: null };
/** What every row of one render shares: saved rows, drafts, the row opened by default and the write grant. */
interface RowContext { readonly credentials: readonly SourceControlCredential[]; readonly drafts: SourceControlState['drafts']; readonly first: string | undefined; readonly canWrite: boolean }

function fieldView({ info, field, draft }: { info: SourceControlProviderInfo; field: SourceControlField; draft: SourceControlDraft }, { controller }: { controller: SourceControlController | null }) {
  return { name: field.name, label: `${info.label} ${field.label}`, value: draft.values[field.name] ?? '', secret: !!field.secret, required: !!field.required, hint: field.userHelp ?? field.hint ?? field.help, onValueChange({ value }: { value: string }) { controller?.setField({ providerId: info.id, name: field.name, value }); } };
}

function rowView({ info, context }: { info: SourceControlProviderInfo; context: RowContext }, { controller }: { controller: SourceControlController | null }) {
  const { credentials, drafts, first, canWrite } = context;
  const saved = defaultSourceControlCredential({ credentials, providerId: info.id }), draft = drafts[info.id] ?? blankSourceControlDraft({}), tokenPageUrl = safeSourceControlUrl({ url: info.tokenPageUrl });
  return { id: info.id, label: info.label, heading: saved ? info.label : `Connect ${info.label}`, saved, defaultOpen: info.id === first, canEdit: canWrite && info.listed, unlisted: !info.listed, connected: !!saved,
    token: draft.token, tokenLabel: `${info.label} ${info.tokenLabel}`, hint: saved ? 'Leave blank to keep the current token.' : 'Once saved, the token is never displayed again.', saving: draft.saving, error: draft.error,
    disabled: !canWrite || !sourceControlReady({ info, draft }), help: info.help, tokenPageUrl, hasGuidance: !!info.help || !!tokenPageUrl,
    fields: info.fields.map(field => fieldView({ info, field, draft }, { controller })),
    onToken({ value }: { value: string }) { controller?.setToken({ providerId: info.id, value }); }, save() { void controller?.save({ providerId: info.id }); },
  };
}

export function useProvidersTab({ permissions = [] }: TabViewProps, _optional = {}) {
  const ports = useSourceControlPorts({}), key = permissions.join('\0'), canRead = permissions.includes('source-control.read'), canWrite = canRead && permissions.includes('source-control.credentials.write');
  const { controller, snapshot } = useController({ create: () => createSourceControlController({ api: ports.sourceControlApi, permissions }), dependencies: [ports.sourceControlApi, key] }, { start: ({ controller }) => { void controller.load({}); } });
  const state = snapshot ?? UNMOUNTED, credentials = state.credentials, infos = sourceControlProviders({ providers: state.providers, credentials });
  const first = infos.find(p => p.listed && !defaultSourceControlCredential({ credentials, providerId: p.id }))?.id;
  const rows = infos.map(info => rowView({ info, context: { credentials, drafts: state.drafts, first, canWrite } }, { controller }));
  return { denied: !canRead, loading: state.loading, rows, errors: [state.error, state.catalogError].filter((s): s is string => !!s), reload() { void controller?.load({}); }, canManage: !!ports.sourceControlNavigation, manage() { ports.sourceControlNavigation?.open({ kind: 'source-control' }); } };
}
export type SourceControlRowView = ReturnType<typeof useProvidersTab>['rows'][number];
