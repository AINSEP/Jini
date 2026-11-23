import type { TabViewProps } from '@jini-ai/core/contracts/admin-module';
import { useController } from '../../../core/react/use-controller.js';
import { createRootKeyController } from '../../controllers/root-key.controller.js';
import { ROOT_KEY_PERMISSION, START_FRESH_CONFIRMATION, isRootKeyLocked, rootKeyBadge, rootKeySourceNote, type RootKeyRefusal } from '../../rules.js';
import type { SecurityTranslator } from '../../messages.en.js';
import { unavailableRootKey, useSecurityChrome, useSecurityPorts, type DescribeRootKeyRefusal } from './SecurityPorts.hooks.js';
type RootKeySnapshot = ReturnType<ReturnType<typeof createRootKeyController>['getSnapshot']>;
/** Host choices handed in through the tab's params (see `SecurityRootKeyTabOptions`). */
function rootKeyOptions({ params }: { params: TabViewProps['params'] }, _optional = {}) {
  return { generate: params.generate === 'hidden' ? 'hidden' as const : 'shown' as const, defaultEnvVarName: typeof params.defaultEnvVarName === 'string' ? params.defaultEnvVarName : undefined };
}
/** Before the controller exists the tab reads as loading with nothing known yet. */
function rootKeyProgress({ snapshot: s }: { snapshot: RootKeySnapshot | null }, _optional = {}) {
  return { loading: s?.loading ?? true, saving: s?.saving ?? false, status: s?.status, error: s?.error, result: s?.result };
}
function rootKeyInputs({ snapshot: s }: { snapshot: RootKeySnapshot | null }, _optional = {}) {
  return { token: s?.token ?? '', confirm: s?.confirm ?? '', confirming: s?.confirming ?? false, preview: s?.preview };
}
/** Create-only: offered for no key at all, never over an env or file source. */
function canGenerateKey({ status, generate }: { status: RootKeySnapshot['status'] | undefined; generate: 'shown' | 'hidden' }, _optional = {}) {
  return generate === 'shown' && status?.state === 'missing' && !status.active && status.source === 'none';
}
function rootKeyFlags({ snapshot: s, generate }: { snapshot: RootKeySnapshot | null; generate: 'shown' | 'hidden' }, _optional = {}) {
  const status = s?.status;
  return { locked: isRootKeyLocked({ status: status ?? null }) || s?.generateError?.kind === 'locked',
    canGenerate: canGenerateKey({ status, generate }), canConfirm: !!s?.preview && s.confirm === START_FRESH_CONFIRMATION };
}
/** What a refused create says: host-approved copy for a known code, else fixed copy. Never reader text. */
function generateErrorText({ refusal, t, describe }: { refusal: RootKeyRefusal | null | undefined; t: SecurityTranslator; describe: DescribeRootKeyRefusal | undefined }, _optional = {}) {
  if (!refusal) return undefined;
  if (refusal.kind === 'already-exists') return t('A key file already exists. This tab only creates a new key — it never overwrites one.');
  return (refusal.code === undefined ? undefined : describe?.({ code: refusal.code })) ?? t('The root key could not be created.');
}
/** Status copy, already translated; `undefined` until the status loads. */
interface RootKeyPresentation { badge: { label: string; tone: 'warning' | 'success' | 'info' } | undefined; note: { text: string; path?: string | undefined; after?: string | undefined } | undefined }
function rootKeyPresentation({ snapshot: s, t, options }: { snapshot: RootKeySnapshot | null; t: SecurityTranslator; options: ReturnType<typeof rootKeyOptions> }, _optional = {}): RootKeyPresentation {
  const status = s?.status; if (!status) return { badge: undefined, note: undefined };
  const badge = rootKeyBadge({ status }, { defaultEnvVarName: options.defaultEnvVarName });
  const note = s.generateError?.kind === 'locked' || isRootKeyLocked({ status }) ? { text: t('Your credentials need their original root key — use the recovery actions below.') } : (({ text, vars, ...rest }) => ({ ...rest, text: t(text, vars) }))(rootKeySourceNote({ status }, options));
  return { badge: { label: t(badge.label, badge.vars), tone: badge.tone }, note: { ...note, after: 'after' in note && note.after ? t(note.after) : undefined } };
}
function scopeLines({ params, snapshot: s, t }: { params: TabViewProps['params']; snapshot: RootKeySnapshot | null; t: SecurityTranslator }, _optional = {}) {
  const lead = typeof params.scopeNotice === 'string' ? params.scopeNotice : t('This key protects saved credentials. Keep its backup separate from the database.');
  // Production keeps the key beside the database, so a full server backup carries both.
  return s?.status?.runtimeMode === 'production' ? [lead, t('On a live site, this key is stored next to the database. Anyone with a full server backup would get both the data and the key that unlocks it.')] : [lead];
}
export function useRootKeyTab({ permissions = [], params }: TabViewProps, { useSecurityChromeHook = useSecurityChrome }: { useSecurityChromeHook?: typeof useSecurityChrome } = {}) {
  const { rootKey } = useSecurityPorts({}); const { t, describeRootKeyError, describeRootKeyRefusal } = useSecurityChromeHook(); const key = permissions.join('\0'); const options = rootKeyOptions({ params });
  const { controller, snapshot: s } = useController({ create: () => createRootKeyController({ api: rootKey ?? unavailableRootKey, permissions }, describeRootKeyError ? { describeError: describeRootKeyError } : {}), dependencies: [rootKey, key, describeRootKeyError] }, { start: ({ controller }) => { void controller.load({}); } });
  const scope = scopeLines({ params, snapshot: s, t });
  return { denied: !rootKey || !permissions.includes(ROOT_KEY_PERMISSION), ...rootKeyProgress({ snapshot: s }), t,
    scopeNotice: scope[0]!, scopeDetail: scope[1], ...rootKeyPresentation({ snapshot: s, t, options }), generateError: generateErrorText({ refusal: s?.generateError, t, describe: describeRootKeyRefusal }),
    ...rootKeyInputs({ snapshot: s }), ...rootKeyFlags({ snapshot: s, generate: options.generate }),
    onToken({ value }: { value: string }) { controller?.setToken({ value }); }, onConfirmText({ value }: { value: string }) { controller?.setConfirm({ value }); },
    generate() { void controller?.generate({}); }, unlock() { void controller?.importToken({}); }, previewFresh() { void controller?.preview({}); },
    cancelFresh() { controller?.cancel({}); }, async confirmFresh() { if (!await controller?.startFresh({})) throw new Error('Recovery was not completed'); },
  };
}
