import { Badge, Button, Menu } from '@jini-ai/ui-kit/react';
import { useMediaCard } from '../hooks/MediaCard.hooks.js';
import type { MediaCardProps } from '../hooks/MediaCard.hooks.js';
import { EyeIcon, ExpandIcon, DocumentIcon } from './MediaIcons.js';
function PreviewMarkup(vm: ReturnType<typeof useMediaCard>, _optional: Record<string, never> = {}) {
  return <>
    {vm.image ? (
      vm.imagePreview ? <Button className="jini-media-card-expand jini-media-card-expand-fill" variant="ghost" attrs={vm.previewAttrs} onPress={vm.preview}>
        <img className="jini-media-card-media" src={vm.src} alt={vm.alt} loading="lazy" onError={vm.onImageError} /><ExpandIcon />
      </Button> : <img className="jini-media-card-media" src={vm.src} alt={vm.alt} loading="lazy" onError={vm.onImageError} />
    ) : vm.video ? (
      <video className="jini-media-card-media" src={vm.src} controls preload="metadata" aria-label={vm.alt} onError={vm.onVideoError} />
    ) : (
      <div className="jini-media-card-placeholder"><DocumentIcon /><p className="jini-media-card-placeholder-text">Preview not available</p>{vm.src && <a className="jini-media-card-placeholder-link" href={vm.src} target="_blank" rel="noreferrer">Download original</a>}</div>
    )}
    {vm.onEdit && <Button className="jini-media-card-edit" variant="ghost" attrs={vm.editAttrs} onPress={vm.onEdit} disabled={vm.busy}><EyeIcon /><span className="jini-visually-hidden">Edit metadata</span></Button>}
    {vm.canPreview && !vm.imagePreview && <Button className="jini-media-card-expand" variant="ghost" attrs={vm.previewAttrs} onPress={vm.preview}><ExpandIcon /><span className="jini-visually-hidden">View larger</span></Button>}
  </>;
}
/** The lightbox uses the same fallback chain without the grid's metadata and actions. */
export function MediaPreview(props: MediaCardProps, _optional: Record<string, never> = {}) {
  const vm = useMediaCard(props);
  return <PreviewMarkup {...vm} />;
}
export function MediaCard(props: MediaCardProps, _optional: Record<string, never> = {}) {
  const vm = useMediaCard(props);
  return <article className="jini-media-card" data-jini-part="media.card" data-media-id={vm.item.id} tabIndex={-1}>
    <div className="jini-media-card-preview" data-jini-part="media.preview.frame"><PreviewMarkup {...vm} /></div>
    <div className="jini-media-card-body">
      <h3 className="jini-media-card-title" title={vm.item.title}>{vm.item.title}</h3>
      <div className="jini-media-card-meta">
        <Badge className={vm.statusClassName} attrs={{ 'data-jini-part': 'media.status' }} tone={vm.statusTone}>{vm.statusLabel}</Badge>
        {vm.menuItems.length > 0 && <Menu label={vm.menuLabel} attrs={vm.menuAttrs} items={vm.menuItems} disabled={vm.busy} />}
      </div>
      <p className="jini-media-card-size"><span>{vm.byteSize}</span>{vm.metadataSeparator}<time dateTime={vm.item.createdAt}>{vm.uploadDate}</time></p>
      {vm.onChoose && <Button attrs={{ 'data-jini-part': 'media.choose', 'data-agent-element': `media-choose-${vm.item.id}` }} onPress={vm.onChoose}>Choose</Button>}
    </div>
  </article>;
}
