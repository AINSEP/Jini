import { hasPermission } from '../../../core/permissions/rules.js';
import type { CommentsProps } from '../pages/CommentsPage.js';
import { useWiredComments } from './use-comments.hooks.js';

export function useCommentsPage(props: CommentsProps, _optional: Record<string, never> = {}) {
  const usePage = props.useCommentsHook ?? useWiredComments;
  const state = usePage({});
  return { ...state,
    canRead: hasPermission({ permissions: state.permissions ?? [], permission: 'comments.read' }),
    canConfigure: hasPermission({ permissions: state.permissions ?? [], permission: 'comments.configure' }) };
}
