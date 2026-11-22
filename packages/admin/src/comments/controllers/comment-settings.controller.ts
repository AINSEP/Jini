import { createControllerStore, hasPermission } from '@jini-ai/core/admin-runtime';
import type { AdminCommentsPort, CommentsSettings } from '../../core/ports/comments.js';
import type { CommentSettingsState } from '../models.js';
import { buildSettingsPatch, validateSettingsPatch, visibleCommentSettingsError } from '../rules.js';
import { englishComments, type CommentsTranslator } from '../messages.en.js';

function createCommentSettingsSaver(
  { api, store }: { api: AdminCommentsPort; store: ReturnType<typeof createControllerStore<CommentSettingsState>> },
  { current, errors, publishError }: { current: () => { canConfigure: boolean; t: CommentsTranslator }; errors: { validationError: string | null; saveError: Error | null }; publishError: () => void },
  onInvalidate: (() => void) | undefined,
) {
  const currentTranslator = () => current().t;
  return async function save({ form }: { form: FormData }, _optional: Record<string, never> = {}) {
    const settings = store.getSnapshot().settings;
    if (!current().canConfigure || !settings || store.signal.aborted) return;
    store.set({ patch: { notice: null } });
    const patch = buildSettingsPatch({ form, current: settings });
    // Validate before sending, matching the backend's spam score bound.
    errors.validationError = validateSettingsPatch({ patch }, { t: current().t });
    if (errors.validationError) { publishError(); return; }
    errors.saveError = null;
    store.set({ patch: { saving: true } });
    publishError();
    try {
      const updated = await api.putCommentsSettings({}, patch);
      if (store.signal.aborted) return;
      onInvalidate?.();
      // Read-your-writes must settle immediately; cache invalidation is deliberately not awaited.
      store.set({ patch: { settings: updated, notice: currentTranslator()('Saved.') } });
    } catch (e) {
      errors.saveError = e instanceof Error ? e : new Error(currentTranslator()('failed to save Comments settings'));
    } finally {
      store.set({ patch: { saving: false } });
      publishError();
    }
  }
}

/** Own the uncontrolled form's diff baseline, validation and server-confirmed save.
 * The query cache owns reads; the FIRST successful read seeds the baseline once.
 * @returns An instance store with seed/save operations; action grants default denied.
 */
export function createCommentSettingsController(
  { api, permissions = [] }: { api: AdminCommentsPort; permissions?: readonly string[] },
  { t = englishComments, onInvalidate }: { t?: CommentsTranslator; onInvalidate?: () => void } = {},
) {
  const store = createControllerStore<CommentSettingsState>({ initial: { settings: null, error: null, saving: false, notice: null } });
  let canConfigure = hasPermission({ permissions, permission: 'comments.configure' });
  const errors = { listError: null as Error | null, saveError: null as Error | null, validationError: null as string | null };
  let seeded = false;
  function publishError() {
    store.set({ patch: { error: visibleCommentSettingsError({ validationError: errors.validationError, saveError: errors.saveError,
      saveFallback: t('failed to save Comments settings'), listError: errors.listError,
      listFallback: t('failed to load Comments settings'), hasSettings: store.getSnapshot().settings !== null }) } });
  }
  /** Update grants/copy while preserving the one-shot uncontrolled-form baseline. */
  function configure(
    { permissions: nextPermissions, t: nextTranslator }: { permissions: readonly string[]; t: CommentsTranslator },
    _optional: Record<string, never> = {},
  ) {
    if (store.signal.aborted) return;
    canConfigure = hasPermission({ permissions: nextPermissions, permission: 'comments.configure' });
    t = nextTranslator;
    publishError();
  }
  function settleRead({ settings, error }: { settings: CommentsSettings | null; error: Error | null }, _optional: Record<string, never> = {}) {
    if (!canConfigure || store.signal.aborted) return;
    // TM-2026-08-12-A: changing defaultValue/defaultChecked does not change an already mounted
    // uncontrolled input. Reseeding its diff baseline on a background refetch would quietly
    // revert another operator's committed field on the next unrelated save. Only this operator's
    // own save may advance it. Accepted trade: the view stays stale until reload; controlled
    // drafts and server compare-and-swap were considered and deliberately deferred.
    if (settings && !seeded) {
      seeded = true;
      store.set({ patch: { settings } });
    }
    errors.listError = error;
    publishError();
  }
  const save = createCommentSettingsSaver({ api, store }, { current: () => ({ canConfigure, t }), errors, publishError }, onInvalidate);
  return { getSnapshot: store.getSnapshot, subscribe: store.subscribe, dispose: store.dispose, configure, settleRead, save };
}
