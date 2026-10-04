import type { TabViewProps } from '../../../react/bind-react.js';
import { useController } from '../../../react/use-controller.js';
import { createSourceControlController } from '../../controllers/source-control.controller.js';
import { blankSourceControlDraft, sourceControlProviders, defaultSourceControlCredential, sourceControlReady, safeSourceControlUrl } from '../../rules.js';
import { useSourceControlPorts } from './SourceControlPorts.hooks.js';
export function useProvidersTab({ permissions = [] }: TabViewProps, _optional = {}) {
  const ports = useSourceControlPorts({}), key = permissions.join('\0'), canRead = permissions.includes('source-control.read'), canWrite = canRead && permissions.includes('source-control.credentials.write');
  const { controller, snapshot: state } = useController({ create: () => createSourceControlController({ api: ports.sourceControlApi, permissions }), dependencies: [ports.sourceControlApi, key] }, { start: ({ controller }) => { void controller.load({}); } });
  const infos = sourceControlProviders({ providers: state?.providers ?? [], credentials: state?.credentials ?? [] });
  const first = infos.find(p => p.listed && !defaultSourceControlCredential({ credentials: state?.credentials ?? [], providerId: p.id }))?.id;
  const rows = infos.map(info => {
    const saved = defaultSourceControlCredential({ credentials: state?.credentials ?? [], providerId: info.id }), draft = state?.drafts[info.id] ?? blankSourceControlDraft({});
    return { id: info.id, label: info.label, heading: saved ? info.label : `Connect ${info.label}`, saved, defaultOpen: info.id === first, canEdit: canWrite && info.listed, unlisted: !info.listed, connected: !!saved,
      token: draft.token, tokenLabel: `${info.label} ${info.tokenLabel}`, hint: saved ? 'Leave blank to keep the current token.' : 'Once saved, the token is never displayed again.', saving: draft.saving, error: draft.error,
      disabled: !canWrite || !sourceControlReady({ info, draft }), help: info.help, tokenPageUrl: safeSourceControlUrl({ url: info.tokenPageUrl }), hasGuidance: !!info.help || !!safeSourceControlUrl({ url: info.tokenPageUrl }),
      fields: info.fields.map(field => ({ name: field.name, label: `${info.label} ${field.label}`, value: draft.values[field.name] ?? '', secret: !!field.secret, required: !!field.required, hint: field.userHelp ?? field.hint ?? field.help, onValueChange({ value }: { value: string }) { controller?.setField({ providerId: info.id, name: field.name, value }); } })),
      onToken({ value }: { value: string }) { controller?.setToken({ providerId: info.id, value }); }, save() { void controller?.save({ providerId: info.id }); },
    };
  });
  return { denied: !canRead, loading: !state || state.loading, rows, errors: [state?.error, state?.catalogError].filter((s): s is string => !!s), reload() { void controller?.load({}); }, canManage: !!ports.sourceControlNavigation, manage() { ports.sourceControlNavigation?.open({ kind: 'source-control' }); } };
}
export type SourceControlRowView = ReturnType<typeof useProvidersTab>['rows'][number];
