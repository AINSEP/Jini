/** Test-only call-shape bridge: all behavior delegates to the production rules. */
import { AdminApiError } from '../../core/transport/errors.js';
import type { AdminComment, CommentStatus } from '../../core/ports/comments.js';
import * as rules from '../rules.js';
import { englishComments, type CommentsTranslator } from '../messages.en.js';
export type { AdminComment, CommentsSettings } from '../../core/ports/comments.js';
export { buildSettingsPatch, emptyRowState } from '../rules.js';
export class ApiError extends AdminApiError {
  constructor(message: string, status: number, code?: string, body?: Record<string, unknown>) { super({ message, status }, { code, body }); }
}
function translator(locale: string): CommentsTranslator {
  const spanish: Record<string, string> = { Approve: 'Aprobar', Spam: 'Spam', Trash: 'Papelera' };
  return locale === 'es' ? key => spanish[key] ?? key : englishComments;
}
export function describeModerationError(e: unknown, locale = 'en') { return rules.describeModerationError({ e }, { t: translator(locale) }); }
export function truncate(text: string, max: number) { return rules.truncate({ text, max }); }
export function parseOptionalNumber(raw: string) { return rules.parseOptionalNumber({ raw }); }
export function parseCloseAfterDays(raw: string) { return rules.parseCloseAfterDays({ raw }); }
export function validateSettingsPatch(patch: Parameters<typeof rules.validateSettingsPatch>[0]['patch'], locale = 'en') { return rules.validateSettingsPatch({ patch }, { t: translator(locale) }); }
export function commentRowMenuItems(comment: AdminComment, context: { permissions: readonly string[]; currentFilterStatus: CommentStatus }, handlers: rules.CommentRowMenuHandlers, locale: string) {
  return rules.commentRowMenuItems({ comment, context, handlers }, { t: translator(locale) });
}
