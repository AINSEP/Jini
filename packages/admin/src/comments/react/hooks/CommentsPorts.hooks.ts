import { createContext, useContext } from 'react';
import { AdminConfigError } from '../../../core/module/create-admin.js';
import type { AdminCommentsPort } from '../../../core/ports/comments.js';
import type { CommentsEventsPort, CommentsSessionPort } from '../../ports.js';
import { englishComments, type CommentsTranslator } from '../../messages.en.js';

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
