import { MediaDialog } from './MediaDialog.js';
import { useMediaLightbox } from '../hooks/MediaLightbox.hooks.js';
import type { MediaLightboxProps } from '../hooks/MediaLightbox.hooks.js';
import { CloseIcon, PreviousIcon, NextIcon } from './MediaIcons.js';
import { MediaPreview } from './MediaCard.js';
/** One shared dialog for the grid: mounting N real dialogs to show at most one open
 * at a time buys nothing and costs N DOM subtrees. */
export function MediaLightbox(props: MediaLightboxProps, _optional: Record<string, never> = {}) {
  const vm = useMediaLightbox(props);
  return (
    <MediaDialog
      className="jini-media-lightbox"
      dialogRef={vm.dialogRef}
      attrs={{ 'data-jini-part': 'media.lightbox', 'data-jini-size': 'large' }}
      title={vm.title}
      open={vm.open}
      onClose={vm.onClose}
    >
      <div className="jini-media-lightbox-header">
        <span className="jini-media-lightbox-title" aria-hidden="true">{vm.item?.title}</span>
        <span className="jini-media-lightbox-counter">{vm.position}</span>
        <button type="button" className="jini-media-lightbox-close" ref={vm.closeRef} data-jini-part="media.lightbox.close" data-agent-element="media-lightbox-close" data-jini-autofocus onClick={vm.onClose}><CloseIcon /><span className="jini-visually-hidden">Close</span></button>
      </div>
      <div className="jini-media-lightbox-stage">
        {vm.hasPrev && <button type="button" className="jini-media-lightbox-nav jini-media-lightbox-nav-prev" data-jini-part="media.lightbox.previous" data-agent-element="media-lightbox-prev" onClick={vm.previous}><PreviousIcon /><span className="jini-visually-hidden">Previous</span></button>}
        <div className="jini-media-lightbox-media">{vm.item && <MediaPreview key={vm.item.id} item={vm.item} api={vm.api} />}</div>
        {vm.hasNext && <button type="button" className="jini-media-lightbox-nav jini-media-lightbox-nav-next" data-jini-part="media.lightbox.next" data-agent-element="media-lightbox-next" onClick={vm.next}><NextIcon /><span className="jini-visually-hidden">Next</span></button>}
      </div>
    </MediaDialog>
  );
}
