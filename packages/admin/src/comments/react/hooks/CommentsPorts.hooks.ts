import { createContext, useContext } from 'react';
import { AdminConfigError } from '@jini-ai/core/admin-runtime';
import type { AdminCommentsPort } from '../../../core/ports/comments.js';
import type { CommentsEventsPort, CommentsSessionPort } from '../../ports.js';
import { englishComments, type CommentsTranslator } from '../../messages.en.js';
import type { UseAdminController } from '@jini-ai/core/contracts/admin-module';

export interface CommentsPorts {
  readonly commentsApi: AdminCommentsPort;
  readonly commentsSession: CommentsSessionPort;
  readonly commentsEvents?: CommentsEventsPort;
}
export const CommentsPortsContext = createContext<CommentsPorts | null>(null);
export const CommentsTranslationContext = createContext<CommentsTranslator>(englishComments);
export function useCommentsPorts(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): CommentsPorts {
  const ports = useContext(CommentsPortsContext);
  if (!ports) throw new AdminConfigError({ issues: ['React scope unavailable: comments'] });
  return ports;
}
export function useCommentsTranslation(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): CommentsTranslator {
  return useContext(CommentsTranslationContext);
}
/** The controller hook the host injects through the module factory (owner answer 2026-11-17, J4:
 * injected, never imported). The factory's Provider supplies it; outside it a hook fails loudly. */
export const CommentsControllerContext = createContext<UseAdminController | null>(null);
function controllerMissing(): never {
  throw new AdminConfigError({ issues: ['Controller hook unavailable: comments'] });
}
export const useCommentsController: UseAdminController = (required, optional = {}) => {
  const useController = useContext(CommentsControllerContext) ?? controllerMissing;
  return useController(required, optional);
};
