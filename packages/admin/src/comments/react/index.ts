import { createElement } from 'react';
import { bindReact } from '../../core/react/bind-react.js';
import { commentsModule } from '../comments.module.js';
import { englishComments, type CommentsTranslator } from '../messages.en.js';
import { CommentsPortsContext, CommentsTranslationContext } from './hooks/CommentsPorts.hooks.js';

export type { CommentsProps } from './pages/CommentsPage.js';
export type { QueueSectionProps } from './components/QueueSection.js';
export type { SettingsSectionProps } from './components/SettingsSection.js';
export { useComments, useWiredComments } from './hooks/use-comments.hooks.js';
export { useCommentQueue, useWiredCommentQueue } from './hooks/use-comment-queue.hooks.js';
export { useCommentSettings, useWiredCommentSettings } from './hooks/use-comment-settings.hooks.js';
export { useCommentsPorts } from './hooks/CommentsPorts.hooks.js';

/** One comments module per admin scope. Host translation is scoped without adding rendered DOM.
 * The queue page is loaded lazily; its two sections retain their current single-page composition.
 */
export function comments(
  _required: Record<string, never>,
  { t = englishComments }: { t?: CommentsTranslator } = {},
) {
  // Scope membership uses object identity, so bind and return this same per-admin module.
  const module = { ...commentsModule };
  const react = bindReact({ module, views: {
    queue: {
      page: async () => {
        const { CommentsPage } = await import('./pages/CommentsPage.js');
        return { default: (_props: import('../../core/react/bind-react.js').ModulePageProps) => createElement(CommentsPage, {}) };
      },
      tabs: {},
    },
  } }, { context: CommentsPortsContext });
  const ScopeProvider = react.Provider;
  /** A live translator override keeps locale changes inside the existing scope: rebuilding
   * the module would remount the queue and discard the uncontrolled settings form.
   * @example createElement(feature.react.Provider, { admin, t: hostTranslator, children })
   */
  function Provider({ admin, children, t: currentTranslation = t }: Parameters<typeof ScopeProvider>[0] & { t?: CommentsTranslator }) {
    return createElement(CommentsTranslationContext.Provider, { value: currentTranslation }, createElement(ScopeProvider, { admin, children }));
  }
  return Object.assign(module, { react: { ...react, Provider } });
}
