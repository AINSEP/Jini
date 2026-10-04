import { Suspense } from 'react';
import type { MediaPageProps } from '../hooks/MediaPage.hooks.js';
import { MediaLibraryContext, useMediaPage } from '../hooks/MediaPage.hooks.js';
export function MediaPage(props: MediaPageProps, _optional: Record<string, never> = {}) {
  const vm = useMediaPage(props);
  return (
    <section className="jini-page" data-jini-part="media.page">
      <header className="jini-page-header" data-jini-part="media.header">
        <div className="jini-page-header-text">
          <p className="jini-page-kicker" data-jini-part="media.header.eyebrow">Content</p>
          <h1 className="jini-page-title" data-agent-element="media-header">{props.description.label}</h1>
          <p className="jini-page-description" data-jini-part="media.header.subtitle">Upload and manage image and video assets used across the site.</p>
        </div>
        {!vm.denied && <div className="jini-page-actions" data-jini-part="media.header.actions">{vm.headerActions}</div>}
      </header>
      {vm.denied ? (
        <p className="jini-notice jini-notice-error" role="alert">Permission denied</p>
      ) : (
        <>
          <nav className="jini-tab-bar" role="tablist" aria-label="Media">
            {vm.tabs.map((tab) => (
              <button
                className="jini-tab-bar-item"
                key={tab.id}
                type="button"
                role="tab"
                data-jini-part="media.tab"
                data-agent-element={tab.handle}
                aria-selected={tab.selected}
                aria-label={tab.label}
                onClick={tab.onPress}
              >
                <span className="jini-tab-bar-icon" aria-hidden="true">{tab.icon}</span>{tab.label}{tab.count != null && <span className="jini-tab-bar-count">{tab.count}</span>}
              </button>
            ))}
          </nav>
          <MediaLibraryContext.Provider value={vm.library}>
          <Suspense fallback={<p className="jini-notice" role="status">Loading media…</p>}>
            {vm.ActiveTab && (
              <vm.ActiveTab key={vm.activeId} params={vm.params} permissions={vm.permissions} />
            )}
          </Suspense>
          </MediaLibraryContext.Provider>
        </>
      )}
    </section>
  );
}
export default MediaPage;
