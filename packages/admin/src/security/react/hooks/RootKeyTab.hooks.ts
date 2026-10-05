import type { TabViewProps } from '../../../react/bind-react.js';
import { useController } from '../../../react/use-controller.js';
import { createRootKeyController } from '../../controllers/root-key.controller.js';
import { ROOT_KEY_PERMISSION, START_FRESH_CONFIRMATION, isRootKeyLocked } from '../../rules.js';
import { unavailableRootKey, useSecurityPorts } from './SecurityPorts.hooks.js';
export function useRootKeyTab({ permissions = [], params }: TabViewProps, _optional = {}) {
  const { rootKey } = useSecurityPorts({}); const key = permissions.join('\0');
  const { controller, snapshot: s } = useController({ create: () => createRootKeyController({ api: rootKey ?? unavailableRootKey, permissions }), dependencies: [rootKey, key] }, { start: ({ controller }) => { void controller.load({}); } });
  return { denied: !rootKey || !permissions.includes(ROOT_KEY_PERMISSION), loading: s?.loading ?? true, saving: s?.saving ?? false, status: s?.status, error: s?.error, result: s?.result,
    scopeNotice: typeof params.scopeNotice === 'string' ? params.scopeNotice : 'This key protects saved credentials. Keep its backup separate from the database.',
    token: s?.token ?? '', confirm: s?.confirm ?? '', confirming: s?.confirming ?? false, preview: s?.preview,
    locked: isRootKeyLocked({ status: s?.status ?? null }), canGenerate: s?.status?.state === 'missing' && !s.status.active, canConfirm: !!s?.preview && s.confirm === START_FRESH_CONFIRMATION,
    onToken({ value }: { value: string }) { controller?.setToken({ value }); }, onConfirmText({ value }: { value: string }) { controller?.setConfirm({ value }); },
    generate() { void controller?.generate({}); }, unlock() { void controller?.importToken({}); }, previewFresh() { void controller?.preview({}); },
    cancelFresh() { controller?.cancel({}); }, async confirmFresh() { if (!await controller?.startFresh({})) throw new Error('Recovery was not completed'); },
  };
}
