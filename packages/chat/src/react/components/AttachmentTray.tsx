/**
 * @module AttachmentTray
 *
 * Renders staged composer attachments as removable chips. A dumb,
 * props-in/JSX-out implementation of the `AttachmentTraySlot` shape from
 * `ADS-memory/reports/jini-port/recon/r4b-webui-design.md` §2 — a host can pass its own
 * `renderItem` for exotic attachment kinds (screenshots, Figma frames, ...)
 * and this component falls back to the built-in chip otherwise.
 */
import type { ChatAttachment } from '@jini-ai/chat/core';
import { useT } from '../hooks/context.js';
import { Icon } from './Icon.js';
import type { AttachmentTraySlot } from '../slots.js';

export type AttachmentTrayProps = AttachmentTraySlot;

export function AttachmentTray({ attachments, onRemove, renderItem }: AttachmentTrayProps) {
  const t = useT();
  if (attachments.length === 0) return null;
  return (
    <div className="jini-attachment-tray">
      {attachments.map((a) => (
        <div key={a.path} className="jini-attachment-chip">
          {renderItem ? renderItem(a) : <DefaultAttachmentChip attachment={a} />}
          <button type="button" className="jini-attachment-remove" onClick={() => onRemove(a.path)} title={t('Remove {name}', { name: a.name })} aria-label={t('Remove {name}', { name: a.name })}>
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

function DefaultAttachmentChip({ attachment }: { attachment: ChatAttachment }) {
  const size = formatAttachmentSize(attachment.size);
  return (
    <span className="jini-attachment-chip-body">
      <span className={`jini-attachment-chip-icon is-${attachment.kind}`}>
        <Icon name={attachment.kind === 'image' ? 'image' : 'file'} size={15} />
      </span>
      <span className="jini-attachment-chip-copy">
        <span className="jini-attachment-chip-name" title={attachment.name}>
          {attachment.name}
        </span>
        {size ? <small className="jini-attachment-chip-size">{size}</small> : null}
      </span>
    </span>
  );
}

/** Formats optional byte counts for the compact composer attachment chip. */
export function formatAttachmentSize(size: number | undefined): string | null {
  if (size === undefined || !Number.isFinite(size) || size < 0) return null;
  if (size < 1_024) return `${Math.round(size)} B`;
  const units = ['KB', 'MB', 'GB'] as const;
  let value = size / 1_024;
  let unitIndex = 0;
  while (value >= 1_024 && unitIndex < units.length - 1) {
    value /= 1_024;
    unitIndex += 1;
  }
  const formatted = value < 10 ? value.toFixed(1).replace(/\.0$/u, '') : Math.round(value).toString();
  return `${formatted} ${units[unitIndex]}`;
}
