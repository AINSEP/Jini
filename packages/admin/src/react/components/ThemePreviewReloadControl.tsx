export function ThemePreviewReloadControl({
  className,
  label,
  reload,
  disabled = false,
}: {
  className: string;
  label: string;
  reload: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      title={label}
      onClick={reload}
      disabled={disabled}
    >
      {/* One circular arrow (Lucide `rotate-cw`, ISC). The two-arrow sync glyph it replaced read
          as unfamiliar (owner, 2026-10-10). */}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
      </svg>
    </button>
  );
}
