import { createControllerStore } from '../../core/module/controller-store.js';
import { hasPermission } from '../../core/permissions/rules.js';
import type { AdminCommentsPort, CommentsSettings } from '../../core/ports/comments.js';
import type { CommentSettingsState } from '../models.js';
import { buildSettingsPatch, validateSettingsPatch, visibleCommentSettingsError } from '../rules.js';
import { englishComments, type CommentsTranslator } from '../messages.en.js';

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
  let seeded = false;
  let listError: Error | null = null;
  let saveError: Error | null = null;
  let validationError: string | null = null;
  function publishError() {
    store.set({ patch: { error: visibleCommentSettingsError({ validationError, saveError,
      saveFallback: t('failed to save Comments settings'), listError,
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
    listError = error;
    publishError();
  }
  async function save({ form }: { form: FormData }, _optional: Record<string, never> = {}) {
    const settings = store.getSnapshot().settings;
    if (!canConfigure || !settings || store.signal.aborted) return;
    store.set({ patch: { notice: null } });
    const patch = buildSettingsPatch({ form, current: settings });
    // Validate before sending, matching the backend's spam score bound.
    validationError = validateSettingsPatch({ patch }, { t });
    if (validationError) { publishError(); return; }
    saveError = null;
    store.set({ patch: { saving: true } });
    publishError();
    try {
      const updated = await api.putCommentsSettings({}, patch);
      if (store.signal.aborted) return;
      onInvalidate?.();
      // Read-your-writes must settle immediately; cache invalidation is deliberately not awaited.
      store.set({ patch: { settings: updated, notice: t('Saved.') } });
    } catch (e) {
      saveError = e instanceof Error ? e : new Error(t('failed to save Comments settings'));
    } finally {
      store.set({ patch: { saving: false } });
      publishError();
    }
  }
  return { getSnapshot: store.getSnapshot, subscribe: store.subscribe, dispose: store.dispose, configure, settleRead, save };
}
