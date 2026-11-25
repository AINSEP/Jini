import { createElement, type ComponentType, type ReactNode } from 'react';
import type { AdminInstance, AdminModuleUi } from '@jini-ai/core/contracts/admin-module';
import { commentsModule } from '../comments.module.js';
import { englishComments, type CommentsTranslator } from '../messages.en.js';
import { CommentsPortsContext, CommentsTranslationContext, CommentsControllerContext } from './hooks/CommentsPorts.hooks.js';

export type { CommentsProps } from './pages/CommentsPage.js';
export type { QueueSectionProps } from './components/QueueSection.js';
export type { SettingsSectionProps } from './components/SettingsSection.js';
export { useComments, useWiredComments } from './hooks/use-comments.hooks.js';
export type { CommentQueueScope } from './hooks/use-comment-queue.hooks.js';
export { CommentQueueScopeProvider, useCommentQueue, useWiredCommentQueue } from './hooks/use-comment-queue.hooks.js';
export { useCommentSettings, useWiredCommentSettings } from './hooks/use-comment-settings.hooks.js';
export { useCommentsPorts, CommentsControllerContext } from './hooks/CommentsPorts.hooks.js';

/** The host injects the renderer helpers; this module states the contract and imports no implementation. */
type ModuleUi<Page, Tab> = AdminModuleUi<Page, Tab, ComponentType<{ admin: AdminInstance; children: ReactNode }>>;
/** One comments module per admin scope. Host translation is scoped without adding rendered DOM.
 * The queue page is loaded lazily; its two sections retain their current single-page composition.
 */
export function comments<Page, Tab>(
  { ui }: { ui: ModuleUi<Page, Tab> },
  { t = englishComments }: { t?: CommentsTranslator } = {},
) {
  // Scope membership uses object identity, so bind and return this same per-admin module.
  const module = { ...commentsModule };
  const react = ui.bindReact({ module, views: {
    queue: {
      page: async () => {
        const [{ CommentsPage }, { useCommentsPage }] = await Promise.all([import('./pages/CommentsPage.js'), import('./hooks/CommentsPage.hooks.js')]);
        return { default: (_props: import('@jini-ai/core/contracts/admin-module').ModulePageProps) => createElement(CommentsPage, { useCommentsPageHook: useCommentsPage }) };
      },
      tabs: {},
    },
  } }, { context: CommentsPortsContext });
  const ScopeProvider = react.Provider;
  /** A live translator override keeps locale changes inside the existing scope: rebuilding
   * the module would remount the queue and discard the uncontrolled settings form.
   * @example createElement(feature.react.Provider, { admin, t: hostTranslator, children })
   */
  function Provider({ admin, children, t: currentTranslation = t }: { admin: AdminInstance; children: ReactNode } & { t?: CommentsTranslator }) {
    return createElement(CommentsTranslationContext.Provider, { value: currentTranslation }, createElement(CommentsControllerContext.Provider, { value: ui.useController }, createElement(ScopeProvider, { admin, children })));
  }
  return Object.assign(module, { react: { ...react, Provider } });
}
