import { Icon } from '../../../../react/components/Icon.js';

export interface AudioViewerBodyProps {
  src: string;
  /** File name shown under the icon (the source component showed the raw
   *  file name here). */
  label: string;
}

/** `<audio>` player with a small icon+filename card — generalizes the
 *  source component's `AudioViewer` once the daemon-specific URL-building
 *  is stripped out. */
export function AudioViewerBody({ src, label }: AudioViewerBodyProps) {
  return (
    <div className="jini-audio-card">
      <Icon name="mic" size={28} />
      <div className="jini-audio-card-name">{label}</div>
      <audio src={src} controls preload="metadata" />
    </div>
  );
}
