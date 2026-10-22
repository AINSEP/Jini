import { QueueSection } from '../components/QueueSection.js';
import { SettingsSection } from '../components/SettingsSection.js';
import { useWiredComments } from '../hooks/use-comments.hooks.js';
import { useCommentsPage } from '../hooks/CommentsPage.hooks.js';

export interface CommentsProps {
  /**
   * Dependency injection seam for tests — the same convention `@jini-ai/ui`'s `CustomSelect` uses
   * for `useCustomSelect`. Defaulted to the real hook, so production callers (`panels.tsx`) pass
   * nothing and behave exactly as before.
   */
  useCommentsHook?: typeof useWiredComments;
}

export function CommentsPage(props: CommentsProps = {}) {
  const { permissions, error, t, canRead, canConfigure } = useCommentsPage(props);

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
