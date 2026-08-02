import { useEffect, useRef, useState } from 'react';
import { fallbackLogoInitials, fallbackLogoPaletteIndex } from '../rules.js';

const FALLBACK_PALETTE_SIZE = 6;

export interface ConnectorLogoProps {
  connectorId: string;
  connectorName: string;
  /** Host-resolved logo URL. Falls back to an initials tile when absent or on load failure. */
  logoUrl?: string | undefined;
  size?: 'sm' | 'lg';
}

/**
 * Connector brand mark. Tries the host-resolved logo URL and gracefully
 * degrades to a colored initials tile if it's absent or fails to load.
 * Decorative by default — the surrounding caption (card title / drawer
 * heading) is the accessible label.
 */
export function ConnectorLogo({ connectorId, connectorName, logoUrl, size = 'sm' }: ConnectorLogoProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [state, setState] = useState<'pending' | 'loaded' | 'error'>(logoUrl ? 'pending' : 'error');

  useEffect(() => {
    if (!logoUrl) {
      setState('error');
      return;
    }
    setState('pending');
    const image = imageRef.current;
    if (image?.complete) {
      setState(image.naturalWidth > 0 ? 'loaded' : 'error');
    }
  }, [logoUrl]);

  const initials = fallbackLogoInitials(connectorName);
  const palette = fallbackLogoPaletteIndex(connectorId || connectorName, FALLBACK_PALETTE_SIZE);
  const showImage = Boolean(logoUrl) && state !== 'error';

  return (
    <span
      className={`connector-logo size-${size} state-${state}${showImage ? '' : ' is-fallback'}`}
      data-palette={palette}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          key={logoUrl}
          ref={imageRef}
          className="connector-logo-img"
          src={logoUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onLoad={() => setState('loaded')}
          onError={() => setState('error')}
        />
      ) : null}
      <span className="connector-logo-fallback">{initials}</span>
    </span>
  );
}
