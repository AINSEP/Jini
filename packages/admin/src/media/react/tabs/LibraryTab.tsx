import { Button, Select, TextField } from '@jini-ai/ui-kit/react';
import type { TabViewProps } from '../../../core/react/bind-react.js';
import { useLibraryTab } from '../hooks/LibraryTab.hooks.js';
import { MediaGrid } from '../components/MediaGrid.js';
import { UploadButton } from '../components/UploadButton.js';
import { EditMediaPanel } from '../components/EditMediaPanel.js';
import { MediaLightbox } from '../components/MediaLightbox.js';
import { MediaPurgeDialog } from '../components/MediaPurgeDialog.js';
export function LibraryTab(props: TabViewProps, _optional: Record<string, never> = {}) {
  const vm = useLibraryTab(props);
  return (
    <section className="jini-media-library" data-jini-part="media.library">
      {vm.canUpload && <UploadButton upload={vm.upload} disabled={vm.busy} />}
      <div className="jini-media-order-control">
        <Select label="Order by" attrs={{ 'data-jini-part': 'media.sort', 'data-agent-element': 'media-order-by' }}
          value={vm.orderBy} onValueChange={vm.onOrder}
          options={[{ value: 'created', label: 'Created (newest first)' }, { value: 'alphabetical', label: 'Alphabetical (A–Z)' }]} />
      </div>
      {/* Keep the additional library controls agent-addressable without changing the legacy row. */}
      <div className="jini-media-library-filters" hidden>
        <TextField attrs={{ 'data-jini-part': 'media.search', 'data-agent-element': 'media-search' }} label="Search media" value={vm.search} onValueChange={vm.onSearch} />
        <Select label="Status" value={vm.statusFilter} onValueChange={vm.onStatus} options={[{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'trashed', label: 'Trash' }]} />
      </div>
      <p className="jini-media-success" role="status" aria-live="polite" aria-atomic="true">{vm.success}</p>
      {vm.untyped && <p className="jini-notice">{vm.t.untyped}</p>}
      {vm.snapshot?.error && <div className="jini-notice jini-notice-error"><p className="jini-notice-text" role="alert">{vm.snapshot.error}</p><Button onPress={vm.onRetry}>Retry</Button></div>}
      {vm.loading ? (
        <p className="jini-notice" role="status">{vm.t.loading}</p>
      ) : (
        <MediaGrid gridRef={vm.gridRef} emptyLabel={vm.emptyLabel} actions={vm.actions} api={vm.mediaApi} />
      )}
      <MediaLightbox
        items={vm.items}
        api={vm.mediaApi}
        activeIndex={vm.lightboxIndex}
        onNavigate={vm.onNavigate}
        onClose={vm.closeLightbox}
      />
      {vm.editing && (
        <EditMediaPanel
          key={vm.editing.id}
          api={vm.mediaApi}
          item={vm.editing}
          onSaved={vm.saved}
          onClose={vm.closeEdit}
        />
      )}
      <MediaPurgeDialog
        open={!!vm.snapshot?.pendingPurge}
        pending={vm.busy}
        {...(vm.snapshot?.pendingPurge ? { filename: vm.snapshot.pendingPurge.title } : {})}
        onCancel={vm.cancelPurge}
        onConfirm={vm.confirmPurge}
      />
    </section>
  );
}
export default LibraryTab;
