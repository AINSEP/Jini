import { createControllerStore } from '@jini-ai/core/admin-runtime';
import type { RootKeyPort } from '../ports.js';
import type { RootKeyStatus, RootKeyPreview, RootKeyResult } from '../models.js';
import { englishSecurity, type SecurityTranslator } from '../messages.en.js';
import { ROOT_KEY_PERMISSION, START_FRESH_CONFIRMATION, isRootKeyLocked, classifyRootKeyGenerateFailure, rootKeyGenerateFailureText, rootKeyRefusalText, type DescribeRootKeyError, type DescribeRootKeyRefusal, type RootKeyErrorDescription, type RootKeyGenerateFailure } from '../rules.js';
import { REVEAL_IDLE, createRootKeyReveal, type RevealClipboard } from './root-key-reveal.js';
const receiverLabel = (w: NonNullable<RootKeyResult['affectedWebhooks']>[number]) => `${w.label} (${w.targetUrl})`;
/** Receivers named in a result need their new signing secret; the message tells the operator which ones. */
function resultMessage({ result, response, t }: { result: string; response: RootKeyResult; t: SecurityTranslator }, _optional = {}) {
  const hooks = response.affectedWebhooks;
  return hooks?.length ? `${result} ${t('rootKeyUpdateReceivers', { names: hooks.map(receiverLabel).join(', ') })}` : result;
}
/** Credentials saved under a temporary key since the lock are moved over; the count says how many. */
function unlockedMessage({ response, t }: { response: RootKeyResult; t: SecurityTranslator }, _optional = {}) {
  const resealed = response.resealed ?? 0;
  return resealed > 0 ? `${t('rootKeyUnlocked')} ${t('rootKeyResealed', { count: resealed })}` : t('rootKeyUnlocked');
}
/** A throwing describer must not turn a refusal into an unhandled error, so it reads as no detail. */
function described({ error, describeError }: { error: unknown; describeError?: DescribeRootKeyError | undefined }, _optional = {}): RootKeyErrorDescription {
  try { return describeError?.({ error }) ?? {}; } catch { return {}; }
}
const RECOVERY_REFUSED = 'Recovery refused. Check the host key configuration.';
const PREVIEW_UNAVAILABLE = 'Recovery preview unavailable';
const REVEAL_FAILED = 'Root key could not be revealed.';
function initialState(_required: Record<string, never> = {}, _optional = {}) {
  return { status: null as RootKeyStatus | null, preview: null as RootKeyPreview | null, token: '', confirm: '', loading: false, saving: false, error: null as string | null, result: null as string | null, confirming: false, generateFailure: null as RootKeyGenerateFailure | null, ...REVEAL_IDLE };
}
type Patch = Partial<ReturnType<typeof initialState>>;
/** `previewRequired: false` lets a failed preview still open the confirm step (DC-5); the typed phrase stays required. */
export interface RootKeyControllerOptions {
  readonly describeError?: DescribeRootKeyError; readonly describeRefusal?: DescribeRootKeyRefusal;
  readonly t?: SecurityTranslator; readonly previewRequired?: boolean; readonly clipboard?: RevealClipboard;
}
export function createRootKeyController({ api, permissions = [] }: { api: RootKeyPort; permissions?: readonly string[] }, { describeError, describeRefusal, t = englishSecurity, previewRequired = true, clipboard }: RootKeyControllerOptions = {}) {
  const granted = permissions.includes(ROOT_KEY_PERMISSION);
  const store = createControllerStore({ initial: initialState() }); let generation = 0;
  const allowed = () => granted && !store.signal.aborted;
  const locked = () => { const s = store.getSnapshot(); return isRootKeyLocked({ status: s.status, generateFailure: s.generateFailure }); };
  /** Only a described code reaches the page, as host copy or fixed text; the pasted key never can. */
  const refusal = (fallback: string) => (error: unknown) => rootKeyRefusalText({ code: described({ error, describeError }).code, fallback }, { describeRefusal });
  const revealer = createRootKeyReveal({ api, store, allowed }, { failureText: refusal(REVEAL_FAILED), clipboard });
  const canPreview = () => { const state = store.getSnapshot(); return allowed() && locked() && !state.saving && !state.loading; };
  const canStartFresh = (state: ReturnType<typeof store.getSnapshot>) => locked() && state.confirming && (state.preview !== null || !previewRequired) && state.confirm === START_FRESH_CONFIRMATION;
  async function load(_required: Record<string, never>, _optional = {}) {
    if (!allowed()) return;
    revealer.clear(); generation += 1;
    const ticket = generation; store.set({ patch: { loading: true } });
    try { const status = await api.status({}, { signal: store.signal }); if (ticket === generation) store.set({ patch: { status, error: null } }); }
    catch { if (ticket === generation) store.set({ patch: { error: 'Root key status unavailable' } }); }
    finally { if (ticket === generation) store.set({ patch: { loading: false } }); }
  }
  async function execute(run: () => Promise<RootKeyResult>, success: (response: RootKeyResult) => string, failed: (error: unknown) => Patch = (error) => ({ error: refusal(RECOVERY_REFUSED)(error) })) {
    if (!allowed() || store.getSnapshot().saving) return false;
    store.set({ patch: { saving: true, error: null } }); let ok = false;
    try { const response = await run(); store.set({ patch: { token: '', confirm: '', preview: null, confirming: false, generateFailure: null, result: resultMessage({ result: success(response), response, t }) } }); await load({}); ok = !store.signal.aborted; }
    catch (error) { store.set({ patch: failed(error) }); }
    finally { store.set({ patch: { saving: false } }); }
    return ok;
  }
  /** Without a required preview, a failed preview still opens the confirm step and shows why. */
  const previewFailed = (error: unknown): Patch => ({ error: refusal(PREVIEW_UNAVAILABLE)(error), ...(previewRequired ? {} : { confirming: true, preview: null }) });
  return {
    getSnapshot: store.getSnapshot, subscribe: store.subscribe, load,
    setToken({ value }: { value: string }, _optional = {}) { if (allowed() && !store.getSnapshot().saving) store.set({ patch: { token: value } }); },
    setConfirm({ value }: { value: string }, _optional = {}) { if (allowed() && !store.getSnapshot().saving) store.set({ patch: { confirm: value } }); },
    generate(_required: Record<string, never>, _optional = {}) {
      const status = store.getSnapshot().status;
      // No rotate/replace: replacing an active key would orphan every secret sealed under it.
      if (!status || status.active || status.state !== 'missing' || status.source !== 'none') return Promise.resolve(false);
      return execute(() => api.generate({}, { signal: store.signal }), () => 'Root key ready', (error) => {
        const generateFailure = classifyRootKeyGenerateFailure({ description: described({ error, describeError }) });
        return { generateFailure, error: rootKeyGenerateFailureText({ failure: generateFailure }, { describeRefusal }) };
      });
    },
    importToken(_required: Record<string, never>, _optional = {}) { const token = store.getSnapshot().token.trim(); return token && locked() ? execute(() => api.importToken({ token }, { signal: store.signal }), (response) => unlockedMessage({ response, t })) : Promise.resolve(false); },
    async preview(_required: Record<string, never>, _optional = {}) {
      if (!canPreview()) return false;
      generation += 1;
      const ticket = generation; store.set({ patch: { loading: true, preview: null, confirm: '', error: null } }); let ok = false;
      try { const preview = await api.previewStartFresh({}, { signal: store.signal }); if (ticket === generation && allowed()) { store.set({ patch: { preview, confirming: true } }); ok = true; } }
      catch (error) { if (ticket === generation) store.set({ patch: previewFailed(error) }); }
      finally { if (ticket === generation) store.set({ patch: { loading: false } }); }
      return ok;
    },
    startFresh(_required: Record<string, never>, _optional = {}) { const state = store.getSnapshot(); if (!canStartFresh(state)) return Promise.resolve(false);
      return execute(() => api.startFresh({ confirm: state.confirm }, { signal: store.signal }), () => t('rootKeyStartedFresh')); },
    cancel(_required: Record<string, never>, _optional = {}) { if (!store.getSnapshot().saving) { generation++; store.set({ patch: { confirming: false, preview: null, confirm: '', loading: false } }); } },
    reveal: revealer.reveal, copy: revealer.copy, hide: revealer.clear,
    /** The revealed value, read on demand by the human-facing view; `null` unless a reveal is shown. */
    revealedValue(_required: Record<string, never> = {}, _optional = {}) { return revealer.value(); },
    dispose(_required: Record<string, never> = {}, _optional = {}) { generation++; revealer.clear(); store.dispose(); },
  };
}
