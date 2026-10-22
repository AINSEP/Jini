import { adminPort } from '../core/module/token.js';
import type { AdminCommentsPort } from '../core/ports/comments.js';
import type { AdminAuthPort } from '../core/ports/auth.js';

/** Session reads reuse the auth owner; no comments-specific permission endpoint exists. */
export type CommentsSessionPort = Pick<AdminAuthPort, 'me'>;
/** The host filters notifications to the moderation queue. Settings intentionally never subscribe. */
export interface CommentsEventsPort {
  subscribe(required: { onRefresh: () => void }, optional?: Record<string, never>): () => void;
}
export const commentsApiToken = adminPort<AdminCommentsPort, 'admin.comments.api'>({ id: 'admin.comments.api' });
export const commentsSessionToken = adminPort<CommentsSessionPort, 'admin.comments.session'>({ id: 'admin.comments.session' });
export const commentsEventsToken = adminPort<CommentsEventsPort, 'admin.comments.events'>({ id: 'admin.comments.events' });
