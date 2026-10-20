import { useEffect } from 'react';
import { useFetchQuery, useInvalidate } from '@jini-ai/ui/fetch-query';
import { useController } from '../../../core/react/use-controller.js';
import type { AdminCommentsPort, CommentsSettings } from '../../../core/ports/comments.js';
import { createCommentSettingsController } from '../../controllers/comment-settings.controller.js';
import { KEYS } from '../../rules.js';
import type { CommentSettingsState } from '../../models.js';
import { englishComments, type CommentsTranslator } from '../../messages.en.js';
import { useCommentsPorts, useCommentsTranslation } from './CommentsPorts.hooks.js';

const CONFIGURE_GRANTS: readonly string[] = Object.freeze(['comments.configure']);
const NO_GRANTS: readonly string[] = Object.freeze([]);
/** What renders before the controller's first snapshot; mirrors the controller's initial state. */
const BEFORE_FIRST_SNAPSHOT: CommentSettingsState = Object.freeze({ settings: null, error: null, saving: false, notice: null });

export interface CommentSettingsController {
  settings: CommentsSettings | null;
  error: string | null;
  saving: boolean;
  notice: string | null;
  save: (form: FormData) => Promise<void>;
}
/** No refresh-event subscription: background settings reads cannot re-seed an uncontrolled form.
 * The cache envelope is retained for observers of the existing KEYS.settings resource.
 */
export function useCommentSettings(
  { api, canConfigure }: { api: AdminCommentsPort; canConfigure: boolean },
  { t = englishComments }: { t?: CommentsTranslator } = {},
): CommentSettingsController {
  // AC-10: even GET is comments.configure-gated. Skip the doomed read for a denied principal.
  const list = useFetchQuery({ key: KEYS.settings, fetch: async () => ({ data: await api.getCommentsSettings({}) }) }, { enabled: canConfigure });
  const invalidate = useInvalidate();
  const grants = canConfigure ? CONFIGURE_GRANTS : NO_GRANTS;
  const { controller, snapshot } = useController({
    create: () => createCommentSettingsController({ api, permissions: grants }, { t, onInvalidate: () => invalidate({ key: KEYS.settings }) }),
    dependencies: [api, invalidate],
  });
  useEffect(() => { controller?.configure({ permissions: grants, t }); }, [controller, grants, t]);
  useEffect(() => { controller?.settleRead({ settings: list.data?.data ?? null, error: list.error }); }, [controller, list.data, list.error]);
  const { settings, error, saving, notice } = snapshot ?? BEFORE_FIRST_SNAPSHOT;
  return { settings, error, saving, notice, save: async form => { await controller?.save({ form }); } };
}
export function useWiredCommentSettings(
  { canConfigure }: { canConfigure: boolean },
  _optional: Record<string, never> = {},
): CommentSettingsController {
  const { commentsApi } = useCommentsPorts();
  const t = useCommentsTranslation();
  return useCommentSettings({ api: commentsApi, canConfigure }, { t });
}
