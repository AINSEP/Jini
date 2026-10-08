import { useEffect } from 'react';
import { useFetchQuery } from '@jini-ai/ui/fetch-query';
import { useController } from '../../../core/react/use-controller.js';
import { createCommentsController } from '../../controllers/comments.controller.js';
import type { CommentsSessionPort } from '../../ports.js';
import { KEYS } from '../../rules.js';
import { useCommentsPorts, useCommentsTranslation } from './CommentsPorts.hooks.js';
import { englishComments, type CommentsTranslator } from '../../messages.en.js';

export interface CommentsController {
  permissions: readonly string[] | null;
  error: string | null;
  t: CommentsTranslator;
}
/** Shared query cache owns permission I/O; the headless controller owns its visible state. */
export function useComments(
  { session }: { session: CommentsSessionPort },
  { t = englishComments }: { t?: CommentsTranslator } = {},
): CommentsController {
  const list = useFetchQuery({ key: KEYS.permissions, fetch: () => session.me({}) });
  const { controller, snapshot } = useController({ create: () => createCommentsController({}), dependencies: [session] });
  useEffect(() => { controller?.settle({ data: list.data ?? null, error: list.error }); }, [controller, list.data, list.error]);
  return { permissions: snapshot?.permissions ?? null, error: snapshot?.error ?? null, t };
}
export function useWiredComments(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): CommentsController {
  const { commentsSession } = useCommentsPorts();
  const t = useCommentsTranslation();
  return useComments({ session: commentsSession }, { t });
}
