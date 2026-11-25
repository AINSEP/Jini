import { QueueSection } from '../components/QueueSection.js';
import { SettingsSection } from '../components/SettingsSection.js';
import { useWiredComments } from '../hooks/use-comments.hooks.js';
import type { useCommentsPage } from '../hooks/CommentsPage.hooks.js';

export interface CommentsProps {
  /**
   * Dependency injection seam for tests — the same convention `@jini-ai/ui`'s `CustomSelect` uses
   * for `useCustomSelect`. Defaulted to the real hook, so production callers (`panels.tsx`) pass
   * nothing and behave exactly as before.
   */
  useCommentsHook?: typeof useWiredComments;
}

/** The page's view-model hook is a required prop: every mount (the module factory, tests) names
 * the hook it wires, so a missing injection is a compile error rather than a silent fallback. */
export function CommentsPage({ useCommentsPageHook, ...props }: CommentsProps & { useCommentsPageHook: typeof useCommentsPage }) {
  const { permissions, error, t, canRead, canConfigure } = useCommentsPageHook(props);

  if (error) return <div className="notice error">{error}</div>;
  if (!permissions) return <div className="notice">{t("Loading Comments…")}</div>;

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-text">
          <p className="page-kicker">{t("People")}</p>
          <h1 className="page-title">{t("Comments")}</h1>
          <p className="page-description">
            {t("Moderate incoming comments and configure workspace-wide comment behavior.")}
          </p>
        </div>
      </div>
      {canRead ? (
        <QueueSection permissions={permissions} t={t} />
      ) : (
        <div className="notice">{t("You do not have permission to view the moderation queue.")}</div>
      )}
      <SettingsSection canConfigure={canConfigure} t={t} />
    </div>
  );
}

export default CommentsPage;
