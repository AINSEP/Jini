import type { ReactElement, SVGProps } from 'react';
import type { IconName } from '../../icon-name.js';
import { ICON_PATH_DATA } from './icon-path-data.js';

/** The line glyphs added for host tab rows and cards, kept out of `Icon.tsx` so that file's catalog stays
 * under the size ratchet. Geometry is on the 24-unit grid; `Icon.tsx` spreads this table into `ICON_RENDERERS`,
 * which still types the full key set, so a missing glyph is a compile error there, not here. */
type LineGlyphName = Extract<IconName, 'compass' | 'timeline' | 'migrate-forward' | 'folder-outline' | 'folder-plus' | 'tray-export' | 'tray-import' | 'tray-upload' | 'document-lines' | 'document-marked' | 'tiles-four' | 'picture-frame' | 'video-frame' | 'cloud-outline' | 'bin-lidded' | 'flag-triangle' | 'more-horizontal-outline' | 'star-filled'>;

export const LINE_GLYPH_RENDERERS: Record<LineGlyphName, (common: SVGProps<SVGSVGElement>) => ReactElement> = {
    'compass': (common) => (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="m15.4 8.6-2.1 4.7-4.7 2.1 2.1-4.7z" />
        </svg>
    ),
    'timeline': (common) => (
        <svg {...common}>
          <circle cx="6" cy="6.5" r="1.25" />
          <path d="M10 6.5h9" />
          <circle cx="6" cy="12" r="1.25" />
          <path d="M10 12h9" />
          <circle cx="6" cy="17.5" r="1.25" />
          <path d="M10 17.5h9" />
        </svg>
    ),
    'migrate-forward': (common) => (
        <svg {...common}>
          <path d="M4 12h11" />
          <path d="m11 8 4 4-4 4" />
          <path d="M19 5.5v13" />
        </svg>
    ),
    'folder-outline': (common) => (
        <svg {...common}>
          <path d={ICON_PATH_DATA['folder-outline-compact']} />
        </svg>
    ),
    'folder-plus': (common) => (
        <svg {...common}>
          <path d={ICON_PATH_DATA['folder-outline-compact']} />
          <path d="M12 10.5v5M9.5 13h5" />
        </svg>
    ),
    'tray-export': (common) => (
        <svg {...common}>
          <path d="M4.5 14.5v4h15v-4" />
          <path d="M12 15V4.5M8 8.5l4-4 4 4" />
        </svg>
    ),
    'tray-import': (common) => (
        <svg {...common}>
          <path d="M4.5 14.5v4h15v-4" />
          <path d="M12 4.5V15M8 11l4 4 4-4" />
        </svg>
    ),
    'tray-upload': (common) => (
        <svg {...common}>
          <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" />
          <path d="M4 15v3.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V15" />
        </svg>
    ),
    'document-lines': (common) => (
        <svg {...common}>
          <path d="M7 3.5h7l4 4V19a1.5 1.5 0 01-1.5 1.5h-9.5A1.5 1.5 0 015.5 19V5A1.5 1.5 0 017 3.5z" />
          <path d="M14 3.5V8h4M9 12.5h6M9 16h4" />
        </svg>
    ),
    'document-marked': (common) => (
        <svg {...common}>
          <path d={ICON_PATH_DATA['document-outline-compact']} />
          <path d="M14 3.5v4h4M9.3 12.2h5.4M9.3 15.6h5.4" />
        </svg>
    ),
    'tiles-four': (common) => (
        <svg {...common}>
          <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" />
          <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" />
          <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" />
          <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" />
        </svg>
    ),
    'picture-frame': (common) => (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="14" rx="2" />
          <circle cx="8.5" cy="9.5" r="1.5" />
          <path d="M20.5 15.5 16 11l-6.5 6.5M3.5 17l3.5-3.5 2.5 2.5" />
        </svg>
    ),
    'video-frame': (common) => (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="14" rx="2" />
          <path d="M10.25 9.25v5.5l4.5-2.75z" />
        </svg>
    ),
    'cloud-outline': (common) => (
        <svg {...common}>
          <path d="M7 16h9.5a3.5 3.5 0 0 0 .4-6.98A4.75 4.75 0 0 0 7.7 7.2 3.5 3.5 0 0 0 7 16Z" />
        </svg>
    ),
    'bin-lidded': (common) => (
        <svg {...common}>
          <path d="M4.5 7h15M9.5 7V4.75h5V7M6.5 7l.9 12.25h9.2L17.5 7M10.25 10.5v5.5M13.75 10.5v5.5" />
        </svg>
    ),
    'flag-triangle': (common) => (
        <svg {...common}>
          <path d="M12 4.5 3.5 19h17z" />
          <path d="M12 10v4M12 16.5h.01" />
        </svg>
    ),
    'more-horizontal-outline': (common) => (
        <svg {...common}>
          <circle cx="6" cy="12" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="18" cy="12" r="1" />
        </svg>
    ),
    'star-filled': (common) => (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.7l5.9-.9z" />
        </svg>
    ),
};
