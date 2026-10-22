import { Lightbox } from '@jini-ai/ui/admin-widgets';
import { useMediaLightbox } from '../hooks/MediaLightbox.hooks.js';
import type { MediaLightboxProps } from '../hooks/MediaLightbox.hooks.js';
import { MediaPreview } from './MediaCard.js';
/** One shared dialog for the grid: mounting N real dialogs to show at most one open
 * at a time buys nothing and costs N DOM subtrees. Chrome, keyboard and focus come from
 * the shared `Lightbox`; this only supplies the asset and its agent-addressable parts. */
export function MediaLightbox(props: MediaLightboxProps, _optional: Record<string, never> = {}) {
  const vm = useMediaLightbox(props);
  return (
    <Lightbox {...vm.lightbox} className="jini-media-lightbox" labels={{ close: 'Close', previous: 'Previous', next: 'Next' }} partAttrs={MEDIA_LIGHTBOX_PARTS}>
      {vm.item && <div className="jini-media-lightbox-media"><MediaPreview key={vm.item.id} item={vm.item} api={props.api} /></div>}
    </Lightbox>
  );
}
const MEDIA_LIGHTBOX_PARTS = {
  dialog: { 'data-jini-part': 'media.lightbox', 'data-jini-size': 'large' },
  close: { 'data-jini-part': 'media.lightbox.close', 'data-agent-element': 'media-lightbox-close' },
  previous: { 'data-jini-part': 'media.lightbox.previous', 'data-agent-element': 'media-lightbox-prev' },
  next: { 'data-jini-part': 'media.lightbox.next', 'data-agent-element': 'media-lightbox-next' },
};
