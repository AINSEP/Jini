import type { IconRenderer } from './icon-renderer-types.js';

export const ACTION_ICON_RENDERERS = {
    'package-check': (common) => (
        <svg {...common}>
          <path d="M20.5 8.2v5.1L12 17.9l-8.5-4.6V8.2" />
          <path d="M3.5 8.2 12 3.6l8.5 4.6L12 12.8z" />
          <path d="M15.6 19.4l1.9 1.9 3.4-3.9" />
        </svg>
    ),
    'storefront': (common) => (
        <svg {...common}>
          <path d="M3.5 8.5h17l-1.2-4H4.7z" />
          <path d="M5 8.5v11h14v-11" />
          <path d="M9.75 19.5v-5.5h4.5v5.5" />
        </svg>
    ),
    'package-outline': (common) => (
        <svg {...common}>
          <path d="M3.5 8.2 12 3.6l8.5 4.6v7.6L12 20.4l-8.5-4.6z" />
          <path d="M3.5 8.2 12 12.8l8.5-4.6M12 12.8v7.6" />
        </svg>
    ),
    'trash-compact': (common) => (
        <svg {...common}>
          <path d="M4.5 7h15M9.5 7V4.6h5V7" />
          <path d="M6.6 7l.9 12.4h9l.9-12.4" />
          <path d="M10.4 10.5v6M13.6 10.5v6" />
        </svg>
    ),
    'chevron-right-wide': (common) => (
        <svg {...common}>
          <path d="M9 5.5 15.5 12 9 18.5" />
        </svg>
    ),
    'check-long': (common) => (
        <svg {...common}>
          <path d="m5 13 4.5 4.5L19 6.5" />
        </svg>
    ),
    'alert-triangle': (common) => (
        <svg {...common}>
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
    ),
    'arrow-left': (common) => (
        <svg {...common}>
          <path d="M19 12H5" />
          <path d="m12 19-7-7 7-7" />
        </svg>
    ),
    'arrow-up': (common) => (
        <svg {...common}>
          <path d="M12 19V5" />
          <path d="m5 12 7-7 7 7" />
        </svg>
    ),
    'attach': (common) => (
        <svg {...common}>
          <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
    ),
    'bell': (common) => (
        <svg {...common}>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
    ),
    'blocks': (common) => (
        <svg {...common}>
          <path d="M10 22V7a1 1 0 0 0-1-1H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 0 0-1-1H2" />
          <rect x="14" y="2" width="8" height="8" rx="1" />
        </svg>
    ),
    'check': (common) => (
        <svg {...common}>
          <path d="M20 6 9 17l-5-5" />
        </svg>
    ),
    'chevron-down': (common) => (
        <svg {...common}>
          <path d="m6 9 6 6 6-6" />
        </svg>
    ),
    'chevron-left': (common) => (
        <svg {...common}>
          <path d="m15 18-6-6 6-6" />
        </svg>
    ),
    'chevron-right': (common) => (
        <svg {...common}>
          <path d="m9 18 6-6-6-6" />
        </svg>
    ),
    'close': (common) => (
      // Tighter X than the Lucide default (which uses coords 6→18 inside a
      // 24-unit viewBox, so the visible glyph is only 50% of the icon box).
      // Close buttons read as a small dot inside their container at typical
      // 14-18px icon sizes. Extending the strokes to 4→20 lifts the visible
      // extent to ~67% so the X feels balanced inside compact modal close
      // buttons (PluginMediaDetail / NewProjectModal / PreviewModal) without
      // overpowering chip-sized close icons (ChatComposer / SettingsDialog).
        <svg {...common}>
          <path d="M20 4 4 20" />
          <path d="m4 4 16 16" />
        </svg>
    ),
    'copy': (common) => (
        <svg {...common}>
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
    ),
    'comment': (common) => (
        <svg {...common}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
    ),
    'message-circle': (common) => (
        <svg {...common}>
          <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5A8.5 8.5 0 0 1 21 11v.5z" />
        </svg>
    ),
    'discord': (common) => (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M8.52062 13.8458C7.48059 13.8458 6.63159 12.9014 6.63159 11.7446 6.63159 10.5879 7.45936 9.64331 8.52062 9.64331 9.57123 9.64331 10.4308 10.5879 10.4096 11.7446 10.4096 12.9014 9.57123 13.8458 8.52062 13.8458ZM15.4941 13.8458C14.454 13.8458 13.604 12.9014 13.604 11.7446 13.604 10.5879 14.4328 9.64331 15.4941 9.64331 16.5447 9.64331 17.4043 10.5879 17.3831 11.7446 17.3831 12.9014 16.5553 13.8458 15.4941 13.8458ZM10.1253 4.32296 9.81655 3.76001 9.18323 3.86556C7.71915 4.10958 6.32658 4.54677 5.02544 5.14604L4.79651 5.25148 4.65507 5.46009C2.0418 9.31441 1.3258 13.1087 1.68032 16.8362L1.71897 17.2425 2.04912 17.4824C3.78851 18.7465 5.47417 19.5189 7.12727 20.0257L7.91657 20.2676 9.03013 17.5506C10.9397 18.0226 13.0592 18.0228 14.969 17.5511L16.0757 20.2683 16.8668 20.0256C18.5173 19.5193 20.2137 18.7472 21.9466 17.4811L22.2726 17.243 22.3131 16.8414C22.7491 12.5213 21.616 8.75773 19.3547 5.45652L19.2128 5.24944 18.9846 5.14504C17.6767 4.54685 16.2852 4.10981 14.8309 3.86573L14.2132 3.76207 13.8987 4.30369C13.8112 4.45445 13.7215 4.62464 13.6364 4.79687 12.5441 4.6847 11.456 4.68446 10.3726 4.79652 10.2882 4.62736 10.2025 4.4638 10.1253 4.32296ZM6.71436 16.6102C6.91235 16.7243 7.11973 16.8358 7.32557 16.9381L6.8764 18.034C5.75585 17.6259 4.61837 17.0637 3.4476 16.2557 3.22313 13.1178 3.86092 9.951 6.01196 6.68626 6.90962 6.29123 7.8535 5.98279 8.83606 5.77295 8.89631 5.89831 8.95235 6.02066 8.99839 6.12917L9.27128 6.77238 9.96259 6.67098C11.3152 6.4726 12.6772 6.47234 14.0523 6.67124L14.7424 6.77106 15.0147 6.12917C15.0621 6.01743 15.1167 5.89547 15.1743 5.77322 16.1525 5.98326 17.098 6.29212 18.0029 6.68812 19.8781 9.50857 20.8241 12.6544 20.5486 16.2552 19.3837 17.0625 18.2422 17.6249 17.1193 18.0335L16.6735 16.939C16.8799 16.8365 17.0879 16.7246 17.2865 16.6102 17.7763 16.328 18.3039 15.976 18.6402 15.6397L17.3606 14.3602C17.1969 14.5239 16.837 14.7808 16.3831 15.0423 15.9388 15.2983 15.498 15.5052 15.2164 15.5983 13.2126 16.2608 10.7883 16.2608 8.78443 15.5983 8.50285 15.5052 8.06205 15.2983 7.61772 15.0423 7.16383 14.7808 6.80392 14.5239 6.64017 14.3602L5.36065 15.6397C5.6969 15.976 6.2245 16.328 6.71436 16.6102Z" />
        </svg>
    ),
    'download': (common) => (
        <svg {...common}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="m7 10 5 5 5-5" />
          <path d="M12 15V3" />
        </svg>
    ),
    'draw': (common) => (
        <svg {...common}>
          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" />
          <path d="m14.06 6.19 3.75 3.75" />
        </svg>
    ),
    'edit': (common) => (
        <svg {...common}>
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
    ),
    'eye': (common) => (
        <svg {...common}>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
    ),
    'eye-off': (common) => (
        <svg {...common}>
          <path d="m3 3 18 18" />
          <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
          <path d="M9.9 4.2A9.9 9.9 0 0 1 12 4c6.5 0 10 8 10 8a17.8 17.8 0 0 1-2.1 3.1" />
          <path d="M6.1 6.1C3.5 7.9 2 12 2 12s3.5 8 10 8a9.9 9.9 0 0 0 4.2-.9" />
        </svg>
    ),
    'external-link': (common) => (
        <svg {...common}>
          <path d="M15 3h6v6" />
          <path d="M10 14 21 3" />
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        </svg>
    ),
    'log-out': (common) => (
        <svg {...common}>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="m16 17 5-5-5-5" />
          <path d="M21 12H9" />
        </svg>
    ),
} satisfies Record<string, IconRenderer>;
