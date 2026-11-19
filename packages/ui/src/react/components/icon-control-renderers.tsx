import type { IconRenderer } from './icon-renderer-types.js';

export const CONTROL_ICON_RENDERERS = {
    'plus': (common) => (
        <svg {...common}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
    ),
    'plus-filled': (common) => (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M11 11V5H13V11H19V13H13V19H11V13H5V11H11Z" />
        </svg>
    ),
    'play': (common) => (
        <svg {...common}>
          <path d="M6 4v16l14-8z" />
        </svg>
    ),
    'present': (common) => (
        <svg {...common}>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8" />
          <path d="M12 17v4" />
        </svg>
    ),
    'refresh': (common) => (
        <svg {...common}>
          <path d="M3 12a9 9 0 0 1 15.9-5.7L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-15.9 5.7L3 16" />
          <path d="M3 21v-5h5" />
        </svg>
    ),
    'reload': (common) => (
        <svg {...common}>
          <path d="M21 12a9 9 0 1 1-3-6.7" />
          <path d="M21 4v5h-5" />
        </svg>
    ),
    'search': (common) => (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
    ),
    'send': (common) => (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M3.48 2.41a.75.75 0 0 0-.93.94l2.43 7.9h8.52a.75.75 0 0 1 0 1.5H4.98l-2.43 7.9a.75.75 0 0 0 .93.94 60.5 60.5 0 0 0 18.44-8.98.75.75 0 0 0 0-1.22A60.5 60.5 0 0 0 3.48 2.41Z" />
        </svg>
    ),
    'settings': (common) => (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 0 1-2.82 2.83l-.06-.07a1.7 1.7 0 0 0-1.88-.33 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 0 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.82l.07-.06a1.7 1.7 0 0 0 .33-1.88 1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.56-1.04 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.07A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.04-1.56V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.07.06a1.7 1.7 0 0 0-.33 1.87V9a1.7 1.7 0 0 0 1.56 1.04H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.56 1.04Z" />
        </svg>
    ),
    'share': (common) => (
        <svg {...common}>
          <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
          <path d="m16 6-4-4-4 4" />
          <path d="M12 2v13" />
        </svg>
    ),
    'sliders': (common) => (
        <svg {...common}>
          <path d="M4 21v-7" />
          <path d="M4 10V3" />
          <path d="M12 21v-9" />
          <path d="M12 8V3" />
          <path d="M20 21v-5" />
          <path d="M20 12V3" />
          <path d="M1 14h6" />
          <path d="M9 8h6" />
          <path d="M17 16h6" />
        </svg>
    ),
    'spinner': (common) => (
        <svg {...common} className={`icon-spin ${common.className ?? ''}`.trim()}>
          <path d="M21 12a9 9 0 1 1-6.22-8.56" />
        </svg>
    ),
    'sparkles': (common) => (
        <svg {...common}>
          <path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
          <path d="M19 14v3" />
          <path d="M19 21v-1" />
          <path d="M22 17h-3" />
          <path d="M16 17h-1" />
        </svg>
    ),
    'star': (common) => (
        <svg {...common}>
          <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
        </svg>
    ),
    'stop': (common) => (
        <svg {...common} fill="currentColor" stroke="none">
          {/* Fill ~58% of the viewBox (was 50% at 12/24) so the square reads at
             a weight comparable to the send glyph in the composer's icon-only
             button instead of looking like a tiny dot. */}
          <rect x="5" y="5" width="14" height="14" rx="2" />
        </svg>
    ),
    'swatchbook': (common) => (
      // Lucide-style swatchbook — a folded swatch card peeling off a stacked
      // base. Reads as "brand kit / palette card" rather than the generic
      // `blocks` glyph, matching the Brand Kit nav destination and the
      // "Create Brand Kit" home chip.
        <svg {...common}>
          <path d="M11 17a4 4 0 0 1-8 0V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2Z" />
          <path d="M16.7 13H19a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H7" />
          <path d="M7 17h.01" />
          <path d="m11 8 2.3-2.3a2.4 2.4 0 0 1 3.404.004L18.6 7.6a2.4 2.4 0 0 1 .026 3.434L9.9 19.8" />
        </svg>
    ),
    'sun': (common) => (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
    ),
    'moon': (common) => (
        <svg {...common}>
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
    ),
    'sun-moon': (common) => (
        <svg {...common}>
          <path d="M12 8a2.83 2.83 0 0 0 4 4 4 4 0 1 1-4-4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.9 4.9 1.4 1.4" />
          <path d="m17.7 17.7 1.4 1.4" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.3 17.7-1.4 1.4" />
          <path d="m19.1 4.9-1.4 1.4" />
        </svg>
    ),
    'terminal': (common) => (
      // Lucide-style terminal — a command-prompt chevron plus an underscore
      // input line, used for the workspace "New Terminal" launcher action and
      // the terminal:<id> tab icon.
        <svg {...common}>
          <path d="m7 11 3-3-3-3" />
          <path d="M13 13h6" />
        </svg>
    ),
    'thumbs-up': (common) => (
        <svg {...common}>
          <path d="M7 10v11" />
          <path d="M15 6.8 14 10h4.5a2 2 0 0 1 2 2.3l-1.1 6.6A2.5 2.5 0 0 1 17 21H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h2.8L12 4a2 2 0 0 1 3 2.8Z" />
        </svg>
    ),
    'thumbs-down': (common) => (
        <svg {...common}>
          <path d="M7 14V3" />
          <path d="m15 17.2-1-3.2h4.5a2 2 0 0 0 2-2.3L19.4 5A2.5 2.5 0 0 0 17 3H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2.8L12 20a2 2 0 0 0 3-2.8Z" />
        </svg>
    ),
    'tweaks': (common) => (
        <svg {...common}>
          <path d="M4 6h13" />
          <circle cx="19" cy="6" r="2" />
          <path d="M4 18h7" />
          <circle cx="13" cy="18" r="2" />
          <path d="M17 12H4" />
          <circle cx="19" cy="12" r="2" />
        </svg>
    ),
    'upload': (common) => (
        <svg {...common}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="m17 8-5-5-5 5" />
          <path d="M12 3v12" />
        </svg>
    ),
    'volume': (common) => (
      // Speaker + sound waves (Lucide volume-2). A box-filling glyph so the
      // audio row's icon reads at the same visual weight as `image`/`play`,
      // unlike the narrow vertical `mic`.
        <svg {...common}>
          <path d="M11 5 6 9H2v6h4l5 4z" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
    ),
    'maximize': (common) => (
        <svg {...common}>
          <path d="M8 3H5a2 2 0 0 0-2 2v3" />
          <path d="M16 3h3a2 2 0 0 1 2 2v3" />
          <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
          <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
        </svg>
    ),
    'minimize': (common) => (
        <svg {...common}>
          <path d="M8 3v3a2 2 0 0 1-2 2H3" />
          <path d="M16 3v3a2 2 0 0 0 2 2h3" />
          <path d="M21 16h-3a2 2 0 0 0-2 2v3" />
          <path d="M3 16h3a2 2 0 0 1 2 2v3" />
        </svg>
    ),
    'zoom-in': (common) => (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="M11 8v6" />
          <path d="M8 11h6" />
          <path d="m21 21-4.3-4.3" />
        </svg>
    ),
    'zoom-out': (common) => (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="M8 11h6" />
          <path d="m21 21-4.3-4.3" />
        </svg>
    ),
    'trash': (common) => (
        <svg {...common}>
          <path d="M3 6h18" />
          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
        </svg>
    ),
} satisfies Record<string, IconRenderer>;
