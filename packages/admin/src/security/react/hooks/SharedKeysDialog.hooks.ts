import { useEffect, useRef } from 'react';
import { useController } from '../../../core/react/use-controller.js';
import { createSharedKeysController } from '../../controllers/shared-keys.controller.js';
import type { SharedKeysPort } from '../../ports.js';
import type { SecurityTranslator } from '../../messages.en.js';
/** What the Access Tokens tab passes when Shared Keys is available (custom write grant and a host port). */
export interface SharedKeysDialogProps { readonly port: SharedKeysPort; readonly permissions: readonly string[]; readonly t: SecurityTranslator; readonly onGranted: () => void }
type SharedKeysController = ReturnType<typeof createSharedKeysController>;
type SharedKeysSnapshot = ReturnType<SharedKeysController['getSnapshot']>;
/** Metadata-only choices: label, provider or kind, the plugins it works for, and the server's lock reason. */
function keyRows({ snapshot: s, controller }: { snapshot: SharedKeysSnapshot | null; controller: SharedKeysController | null }, _optional = {}) {
  return (s?.source?.keys ?? []).map(key => ({ id: key.id, checked: key.id === s?.selectedId, text: key.siteName ? key.label : `${key.label} · ${key.provider ?? key.kind}`,
    worksFor: (key.worksFor ?? []).join(', '), locked: key.locked ?? '', select() { controller?.select({ id: key.id }); } }));
}
function omissionRows({ snapshot: s, t }: { snapshot: SharedKeysSnapshot | null; t: SecurityTranslator }, _optional = {}) {
  return (s?.source?.keys ?? []).flatMap(key => key.siteName && key.omittedCount !== undefined ? [{ id: key.id, text: t('sharedKeysMore', { site: key.siteName, count: key.omittedCount }) }] : []);
}
/** Only `granted` reads as granted; every other status shows the fixed failure copy. */
function resultRows({ snapshot: s, t }: { snapshot: SharedKeysSnapshot | null; t: SecurityTranslator }, _optional = {}) {
  return (s?.results ?? []).map((result, index) => ({ key: `${result.id}:${index}`, text: result.status === 'granted' ? t('sharedKeysGranted') : t('sharedKeysGrantFailed') }));
}
function failureText({ snapshot: s, t }: { snapshot: SharedKeysSnapshot | null; t: SecurityTranslator }, _optional = {}) {
  return s?.failure === 'load' ? t('sharedKeysLoadFailed') : s?.failure === 'grant' ? t('sharedKeysGrantFailed') : '';
}
/** Every input locks while the inventory loads or a grant is in flight. */
function dialogState({ snapshot: s }: { snapshot: SharedKeysSnapshot | null }, _optional = {}) {
  if (!s) return { open: false, loading: false, pending: false, locked: true, empty: false };
  return { open: s.open, loading: s.loading, pending: s.pending, locked: s.pending || s.loading, empty: !s.loading && !s.failure && !s.source?.keys.length };
}
/** The Shared Keys picker's view model. `onGranted` is read at grant time, so a re-rendered tab never leaves a stale refresh behind. */
export function useSharedKeysDialog({ port, permissions, t, onGranted }: SharedKeysDialogProps, _optional = {}) {
  const latest = useRef(onGranted);
  useEffect(() => { latest.current = onGranted; });
  const { controller, snapshot: s } = useController({ create: () => createSharedKeysController({ port, permissions }, { onGranted: () => latest.current() }), dependencies: [port, permissions.join('\0')] });
  return { t, ...dialogState({ snapshot: s }), disabled: !controller?.grantable({}),
    error: failureText({ snapshot: s, t }), keys: keyRows({ snapshot: s, controller }), omissions: omissionRows({ snapshot: s, t }), results: resultRows({ snapshot: s, t }),
    show() { void controller?.open({}); }, cancel() { controller?.close({}); }, submit() { void controller?.grant({}); },
  };
}
