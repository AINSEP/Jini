import { useRef } from 'react';
import type { TabViewProps } from '@jini-ai/core/contracts/admin-module';
import type { useController } from '../../../core/react/use-controller.js';
import { createRootKeyController, type RootKeyControllerOptions } from '../../controllers/root-key.controller.js';
import type { RootKeyStatus } from '../../models.js';
import type { SecurityTranslator } from '../../messages.en.js';
import { ROOT_KEY_PERMISSION, START_FRESH_CONFIRMATION, isRootKeyLocked, rootKeyBadge, rootKeySourceNote, type RootKeyBadgeTone, type RootKeyCopy } from '../../rules.js';
import { unavailableRootKey, type useSecurityPorts, type useSecurityTranslation, type useSecurityRootKeyHost, type SecurityRootKeyHost } from './SecurityPorts.hooks.js';
type RootKeySnapshot = ReturnType<ReturnType<typeof createRootKeyController>['getSnapshot']>;
type RootKeyController = ReturnType<typeof createRootKeyController>;
/** Before the controller exists the tab reads as loading with nothing known yet. */
function rootKeyProgress({ snapshot: s }: { snapshot: RootKeySnapshot | null }, _optional = {}) {
  return { loading: s?.loading ?? true, saving: s?.saving ?? false, status: s?.status, error: s?.error, result: s?.result };
}
function rootKeyInputs({ snapshot: s }: { snapshot: RootKeySnapshot | null }, _optional = {}) {
  return { token: s?.token ?? '', confirm: s?.confirm ?? '', confirming: s?.confirming ?? false, preview: s?.preview };
}
/** Create-only, matching the controller's guard: no key, nothing sealed, no env or file source. */
const isCreatable = (status: RootKeyStatus | null | undefined) => !!status && status.state === 'missing' && !status.active && status.source === 'none';
/** A host may also hide create outright. Locked follows the status or a `locked` create refusal, like the controller. */
function canConfirmFresh({ snapshot: s, previewRequired }: { snapshot: RootKeySnapshot; previewRequired: boolean }, _optional = {}) {
  const previewed = s.preview !== null || (!previewRequired && s.confirming);
  return previewed && s.confirm === START_FRESH_CONFIRMATION;
}
function rootKeyFlags({ snapshot: s, generateHidden, previewRequired }: { snapshot: RootKeySnapshot | null; generateHidden: boolean; previewRequired: boolean }, _optional = {}) {
  if (!s) return { locked: false, canGenerate: false, canConfirm: false };
  return { locked: isRootKeyLocked({ status: s.status, generateFailure: s.generateFailure }), canGenerate: !generateHidden && isCreatable(s.status), canConfirm: canConfirmFresh({ snapshot: s, previewRequired }) };
}
/** Reveal state for the human-facing view. The value is read from the controller's private cell only
 * while it is shown; it is never part of the snapshot. */
function rootKeyReveal({ snapshot: s, controller, revealable, t }: { snapshot: RootKeySnapshot | null; controller: RootKeyController | null; revealable: boolean; t: SecurityTranslator }, _optional = {}) {
  const labels = { reveal: t('rootKeyReveal'), hide: t('rootKeyHide'), copy: t(s?.copied ? 'rootKeyCopied' : 'rootKeyCopy') };
  if (!s || !controller) return { canReveal: false, revealing: false, revealError: null, revealedValue: null, revealLabels: labels };
  return { canReveal: revealable && s.status?.active === true, revealing: s.revealing, revealError: s.revealError,
    revealedValue: s.revealed ? controller.revealedValue({}) : null, revealLabels: labels };
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
function controllerOptions({ host, previewRequired, t }: { host: SecurityRootKeyHost; previewRequired: boolean; t: SecurityTranslator }, _optional = {}): RootKeyControllerOptions {
  const { describeError, describeRefusal, clipboard } = host;
  return { previewRequired, t, ...(describeError ? { describeError } : {}), ...(describeRefusal ? { describeRefusal } : {}), ...(clipboard ? { clipboard } : {}) };
}
/** Every hook this tab uses arrives here; the module's view binding supplies them (none is imported). */
export interface RootKeyTabHooks {
  readonly useSecurityPortsHook: typeof useSecurityPorts; readonly useSecurityTranslationHook: typeof useSecurityTranslation;
  readonly useRootKeyHostHook: typeof useSecurityRootKeyHost; readonly useControllerHook: typeof useController;
}
export function useRootKeyTab({ permissions = [], params }: TabViewProps, { useSecurityPortsHook, useSecurityTranslationHook, useRootKeyHostHook, useControllerHook }: RootKeyTabHooks) {
  const { rootKey } = useSecurityPortsHook({}); const key = permissions.join('\0');
  const t = useSecurityTranslationHook({}), host = useRootKeyHostHook({}), previewRequired = params.previewRequired !== false;
  // Controller messages read the live translator, so a locale change never rebuilds the controller.
  const live = useRef(t); live.current = t;
  const translate: SecurityTranslator = (k, vars) => live.current(k, vars);
  const { controller, snapshot: s } = useControllerHook({ create: () => createRootKeyController({ api: rootKey ?? unavailableRootKey, permissions }, controllerOptions({ host, previewRequired, t: translate })), dependencies: [rootKey, key, host, previewRequired] }, { start: ({ controller }) => { void controller.load({}); } });
  return { denied: !rootKey || !permissions.includes(ROOT_KEY_PERMISSION), ...rootKeyProgress({ snapshot: s }),
    ...rootKeyPresentation({ status: s?.status, params, t }), ...rootKeyReveal({ snapshot: s, controller, revealable: !!rootKey?.reveal, t }),
    ...rootKeyInputs({ snapshot: s }), ...rootKeyFlags({ snapshot: s, generateHidden: params.generate === 'hidden', previewRequired }),
    onToken({ value }: { value: string }) { controller?.setToken({ value }); }, onConfirmText({ value }: { value: string }) { controller?.setConfirm({ value }); },
    generate() { void controller?.generate({}); }, unlock() { void controller?.importToken({}); }, previewFresh() { void controller?.preview({}); },
    cancelFresh() { controller?.cancel({}); }, async confirmFresh() { if (!await controller?.startFresh({})) throw new Error('Recovery was not completed'); },
    reveal() { void controller?.reveal({}); }, hide() { controller?.hide({}); }, copy() { void controller?.copy({}); },
  };
}
