import type { Band } from '../../types.js';

export interface SelectionBandProps {
  band: Band | null;
}

/** The visual rubber-band rectangle. `position: fixed` is structural (the band tracks viewport coordinates, matching `snapshotCardRects`'s coordinate space) — everything else about its look is left to the host's CSS via the `asset-grid-band` class. */
export function SelectionBand({ band }: SelectionBandProps) {
  if (!band) return null;
  return (
    <div
      className="jini-asset-grid-band"
      aria-hidden
      style={{ position: 'fixed', left: band.x, top: band.y, width: band.w, height: band.h }}
    />
  );
}
