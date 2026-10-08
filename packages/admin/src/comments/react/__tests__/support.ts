/** Compatibility render/DI harness for assertion-preserving copies of the host suites.
 * Production consumes the core port with two-object calls. These test-only facades translate
 * the old fixture call shape; they contain no alternate screen or controller implementation.
 */
import { createElement, useMemo, type ReactNode } from 'react';
import { createAdmin } from '../../../core/module/create-admin.js';
import { createHttpTransport } from '../../../core/transport/http.js';
import { AdminApiError } from '../../../core/transport/errors.js';
import type { AdminComment, AdminCommentsPort, AdminCommentsQueuePage, CommentsSettings, CommentModerationAction, CommentStatus } from '../../../core/ports/comments.js';
import { createMemoryCommentsApi } from '../../adapters/memory.js';
import { createHttpCommentsApi, createHttpCommentsSession, type CommentsTransportPort } from '../../adapters/http.js';
import { comments } from '../index.js';
import { QueueSection as QueueView } from '../components/QueueSection.js';
import { SettingsSection as SettingsView } from '../components/SettingsSection.js';
import { useComments as usePage, useWiredComments as useWiredPage } from '../hooks/use-comments.hooks.js';
import { useCommentQueue as useQueue } from '../hooks/use-comment-queue.hooks.js';
import { useCommentSettings as useSettings } from '../hooks/use-comment-settings.hooks.js';
import { englishComments, type CommentsTranslator } from '../../messages.en.js';
import type { CommentsEventsPort } from '../../ports.js';
import { COMMENTS_QUEUE_RESOURCE } from '../../rules.js';
export type { AdminComment, AdminCommentsQueuePage, CommentsSettings, CommentStatus } from '../../../core/ports/comments.js';
export type { CommentQueueController } from '../hooks/use-comment-queue.hooks.js';
export type { CommentSettingsController } from '../hooks/use-comment-settings.hooks.js';
export { CommentsPage as Comments } from '../pages/CommentsPage.js';

const TEST_GRANTS = ['comments.read', 'comments.moderate', 'comments.delete', 'comments.delete.force', 'comments.configure'];
const TEST_SETTINGS: CommentsSettings = { enabled: true, requireModeration: true, maxDepth: 3,
  closeAfterDays: null, spamAutoRejectScore: 0.05, maxPerIpPerHour: 10 };

export class ApiError extends AdminApiError {
  constructor(message: string, status: number, code?: string, body?: Record<string, unknown>) {
    super({ message, status }, { code, body });
  }
}
export function fixtureTranslator(locale: string): CommentsTranslator {
  const labels: Record<string, string> = locale === 'es' ? { Approve: 'Aprobar', Spam: 'Spam', Trash: 'Papelera' } : {};
  return locale === 'es' ? (key, vars) => labels[key] ?? englishComments(key, vars) : englishComments;
}

/** Real shared transport for existing request assertions; no API behavior is faked here. */
function createTestTransport(): CommentsTransportPort {
  const transport = createHttpTransport({ baseUrl: '/api/admin/v1', fetch: ({ url }, options) => globalThis.fetch(url, options) });
  return {
    request<T>({ path, method, body }: { path: string; method: 'GET' | 'POST' | 'PUT'; body?: unknown }, optional: { signal?: AbortSignal } = {}): Promise<T> {
      return transport.request<T>({ path }, { method, ...optional, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    },
    url: ({ path }) => `/api/admin/v1${path}`,
  };
}

/** The copied hook suites use memory; the full page suite supplies HTTP to preserve path assertions. */
export function CommentsTestProvider({ children, http = false }: { children: ReactNode; http?: boolean }) {
  const scope = useMemo(() => {
    const transport = createTestTransport();
    const module = comments({}, { t: englishComments });
    const api = http ? createHttpCommentsApi({ transport, basePath: '/workspaces/workspace-local/comments' }) : createMemoryCommentsApi({});
    const session = createHttpCommentsSession({ transport, path: '/auth/me' });
    const admin = createAdmin({ modules: [module], ports: { commentsApi: api, commentsSession: session, commentsEvents: testEvents } }, { permissions: TEST_GRANTS });
    return { module, admin };
  }, [http]);
  return createElement(scope.module.react.Provider, { admin: scope.admin, children });
}

export function QueueSection({ locale, ...props }: { locale: string } & Omit<Parameters<typeof QueueView>[0], 't'>) {
  return createElement(QueueView, { ...props, t: fixtureTranslator(locale) });
}
export function SettingsSection({ locale, ...props }: { locale: string } & Omit<Parameters<typeof SettingsView>[0], 't'>) {
  return createElement(SettingsView, { ...props, t: fixtureTranslator(locale) });
}

export function createFakeCommentsPort({ effectivePermissions = [], meError }: { effectivePermissions?: string[]; meError?: Error } = {}) {
  return { async me() { if (meError) throw meError; return { effectivePermissions }; } };
}
export function useComments({ port, locale }: { port: ReturnType<typeof createFakeCommentsPort>; locale: string }) {
  const session = useMemo(() => ({ me: async () => ({ user: { id: 'operator', username: 'operator' }, ...await port.me() }) }), [port]);
  return usePage({ session }, { t: fixtureTranslator(locale) });
}
export function useWiredComments() { return useWiredPage({}); }

export interface CommentQueuePort {
  listCommentsQueue(options: { status?: CommentStatus; cursor?: string }): Promise<AdminCommentsQueuePage>;
  moderateComment(input: { commentId: string; action: CommentModerationAction; expectedVersion: number }): Promise<void>;
  purgeComment(input: { commentId: string }): Promise<void>;
}
export function createFakeCommentQueuePort(options: { items?: AdminComment[]; nextCursor?: string | null; listError?: Error; moderateError?: Error; purgeError?: Error } = {}): CommentQueuePort & {
  readonly listCalls: Array<{ status?: CommentStatus | undefined; cursor?: string | undefined }>;
  readonly moderateCalls: Array<{ commentId: string; action: CommentModerationAction; expectedVersion: number }>;
  readonly purgeCalls: Array<{ commentId: string }>;
} {
  const listCalls: Array<{ status?: CommentStatus | undefined; cursor?: string | undefined }> = [];
  const moderateCalls: Array<{ commentId: string; action: CommentModerationAction; expectedVersion: number }> = [];
  const purgeCalls: Array<{ commentId: string }> = [];
  return {
    listCalls, moderateCalls, purgeCalls,
    async listCommentsQueue({ status, cursor }) {
      listCalls.push({ status, cursor });
      if (options.listError) throw options.listError;
      // Intentionally returns the seeded page for every query: the copied suite proves forwarding,
      // including repeated cursor pages, rather than testing server filtering in the hook.
      return { items: options.items ?? [], nextCursor: options.nextCursor ?? null };
    },
    async moderateComment(input) { moderateCalls.push(input); if (options.moderateError) throw options.moderateError; },
    async purgeComment(input) { purgeCalls.push(input); if (options.purgeError) throw options.purgeError; },
  };
}
export function useCommentQueue({ port, locale }: { port: CommentQueuePort; locale: string }) {
  const api = useMemo<AdminCommentsPort>(() => ({ ...createMemoryCommentsApi({}),
    listCommentsQueue: (_required, options = {}) => port.listCommentsQueue({ ...(options.status ? { status: options.status } : {}), ...(options.cursor ? { cursor: options.cursor } : {}) }),
    moderateComment: input => port.moderateComment(input), purgeComment: input => port.purgeComment(input),
  }), [port]);
  return useQueue({ api, permissions: TEST_GRANTS }, { t: fixtureTranslator(locale), events: testEvents });
}

export function createFakeCommentSettingsPort(options: { settings?: CommentsSettings; getError?: Error; putError?: Error } = {}) {
  const api = createMemoryCommentsApi({ settings: options.settings ?? TEST_SETTINGS });
  return {
    settings: options.settings ?? TEST_SETTINGS,
    async getCommentsSettings() { if (options.getError) throw options.getError; return { data: await api.getCommentsSettings({}) }; },
    async putCommentsSettings(patch: Partial<CommentsSettings>) {
      if (options.putError) throw options.putError;
      this.settings = await api.putCommentsSettings({}, patch);
      return { data: this.settings };
    },
  };
}
export function useCommentSettings(canConfigure: boolean, { port, locale }: { port: ReturnType<typeof createFakeCommentSettingsPort>; locale: string }) {
  const api = useMemo<AdminCommentsPort>(() => ({ ...createMemoryCommentsApi({}),
    getCommentsSettings: async () => (await port.getCommentsSettings()).data,
    putCommentsSettings: async (_required, patch = {}) => (await port.putCommentsSettings(patch)).data,
  }), [port]);
  return useSettings({ api, canConfigure }, { t: fixtureTranslator(locale) });
}

// Test-only event fixture. The real host bus and resource filtering stay in the host.
const refreshListeners = new Set<() => void>();
const testEvents: CommentsEventsPort = {
  subscribe({ onRefresh }) { refreshListeners.add(onRefresh); return () => { refreshListeners.delete(onRefresh); }; },
};
export function publishContentRefresh(resources?: readonly string[]) {
  if (resources && !resources.includes(COMMENTS_QUEUE_RESOURCE)) return;
  for (const listener of refreshListeners) listener();
}
export function resetContentRefreshBus() { refreshListeners.clear(); }
