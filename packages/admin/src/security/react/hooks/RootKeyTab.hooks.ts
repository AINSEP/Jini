import type { TabViewProps } from '@jini-ai/core/contracts/admin-module';
import { useController } from '../../../core/react/use-controller.js';
import { createRootKeyController } from '../../controllers/root-key.controller.js';
import type { RootKeyStatus } from '../../models.js';
import type { SecurityTranslator } from '../../messages.en.js';
import { ROOT_KEY_PERMISSION, START_FRESH_CONFIRMATION, isRootKeyLocked, rootKeyBadge, rootKeySourceNote, type RootKeyBadgeTone, type RootKeyCopy } from '../../rules.js';
import { unavailableRootKey, useSecurityPorts, useSecurityTranslation, useSecurityErrorDescriber } from './SecurityPorts.hooks.js';
type RootKeySnapshot = ReturnType<ReturnType<typeof createRootKeyController>['getSnapshot']>;
/** Before the controller exists the tab reads as loading with nothing known yet. */
function rootKeyProgress({ snapshot: s }: { snapshot: RootKeySnapshot | null }, _optional = {}) {
  return { loading: s?.loading ?? true, saving: s?.saving ?? false, status: s?.status, error: s?.error, result: s?.result };
}
function rootKeyInputs({ snapshot: s }: { snapshot: RootKeySnapshot | null }, _optional = {}) {
  return { token: s?.token ?? '', confirm: s?.confirm ?? '', confirming: s?.confirming ?? false, preview: s?.preview };
}
/** Create-only, matching the controller's guard: no key, nothing sealed, no env or file source. */
const isCreatable = (status: RootKeyStatus | null | undefined) => !!status && status.state === 'missing' && !status.active && status.source === 'none';
/** A host may also hide create outright. */
function rootKeyFlags({ snapshot: s, generateHidden }: { snapshot: RootKeySnapshot | null; generateHidden: boolean }, _optional = {}) {
  return { locked: isRootKeyLocked({ status: s?.status ?? null }), canGenerate: !generateHidden && isCreatable(s?.status), canConfirm: !!s?.preview && s.confirm === START_FRESH_CONFIRMATION };
}
const translateCopy = ({ copy, t }: { copy: RootKeyCopy; t: SecurityTranslator }) => ({ text: t(copy.key, copy.vars), ...(copy.path === undefined ? {} : { path: copy.path }) });
/** Badge, fingerprint hint, source note and the runtime-dependent scope copy, translated. */
function rootKeyPresentation({ status, params, t }: { status: RootKeyStatus | null | undefined; params: TabViewProps['params']; t: SecurityTranslator }, _optional = {}) {
  const envName = typeof params.defaultEnvVarName === 'string' ? { defaultEnvVarName: params.defaultEnvVarName } : {};
  const badge = status ? rootKeyBadge({ status }, envName) : undefined;
  return {
    scopeNotice: typeof params.scopeNotice === 'string' ? params.scopeNotice : t('rootKeyScope'),
    productionNote: status?.runtimeMode === 'production' ? t('rootKeyScopeProduction') : undefined,
    badge: badge ? { label: t(badge.key, badge.vars), tone: badge.tone as RootKeyBadgeTone } : undefined,
    sourceNote: status ? translateCopy({ copy: rootKeySourceNote({ status }, envName), t }) : undefined,
    fingerprintLabel: t('rootKeyFingerprint'), fingerprintHint: t('rootKeyFingerprintHint'),
  };
}
type RootKeyHooks = { useSecurityTranslationHook?: typeof useSecurityTranslation; useSecurityErrorDescriberHook?: typeof useSecurityErrorDescriber };
export function useRootKeyTab({ permissions = [], params }: TabViewProps, { useSecurityTranslationHook = useSecurityTranslation, useSecurityErrorDescriberHook = useSecurityErrorDescriber }: RootKeyHooks = {}) {
  const { rootKey } = useSecurityPorts({}); const key = permissions.join('\0');
  const t = useSecurityTranslationHook({}), describeError = useSecurityErrorDescriberHook({});
  const { controller, snapshot: s } = useController({ create: () => createRootKeyController({ api: rootKey ?? unavailableRootKey, permissions }, describeError ? { describeError } : {}), dependencies: [rootKey, key, describeError] }, { start: ({ controller }) => { void controller.load({}); } });
  return { denied: !rootKey || !permissions.includes(ROOT_KEY_PERMISSION), ...rootKeyProgress({ snapshot: s }),
    ...rootKeyPresentation({ status: s?.status, params, t }),
    ...rootKeyInputs({ snapshot: s }), ...rootKeyFlags({ snapshot: s, generateHidden: params.generate === 'hidden' }),
    onToken({ value }: { value: string }) { controller?.setToken({ value }); }, onConfirmText({ value }: { value: string }) { controller?.setConfirm({ value }); },
    generate() { void controller?.generate({}); }, unlock() { void controller?.importToken({}); }, previewFresh() { void controller?.preview({}); },
    cancelFresh() { controller?.cancel({}); }, async confirmFresh() { if (!await controller?.startFresh({})) throw new Error('Recovery was not completed'); },
  };
}
