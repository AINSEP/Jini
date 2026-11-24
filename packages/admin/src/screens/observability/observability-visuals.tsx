import { LINE_ICON } from "../../shell/components/line-icon.js";
/**
 * @file The Observability screen's own icon set — inline SVGs, no icon dependency. Same rationale
 * `features/plugins/agent-plugins-visuals.tsx` and
 * `source-control/source-control-visuals.tsx` give for theirs: this app ships no icon component
 * library to `features/`, and importing a glyph across a feature boundary would tie this screen's
 * rendering to a sibling feature another agent owns.
 */

// Line-icon attributes: components/line-icon.ts.


export interface IconProps {
  size?: number;
}

/** Queries tab — the stacked records held by the live query cache. */
export function QueriesIcon({ size = 16 }: IconProps) {
  return <svg {...LINE_ICON} width={size} height={size}>
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0v-7" />
  </svg>;
}

/** Overview tab — a waveform, the shape of a trace being recorded. */
export function PulseIcon({ size = 16 }: IconProps) {
  return (
    <svg {...LINE_ICON} width={size} height={size}>
      <path d="M3 13h3.4l1.9-6 2.4 11.5 2.2-9 1.3 3.5h4.8" />
    </svg>
  );
}

/** Providers tab — a gauge with no needle reading, the honest shape of "nothing measured yet". */
export function GaugeIcon({ size = 16 }: IconProps) {
  return (
    <svg {...LINE_ICON} width={size} height={size}>
      <path d="M4.5 16.5a7.5 7.5 0 0 1 15 0" />
      <path d="M12 16.5 15.2 10.8" />
      <circle cx="12" cy="16.5" r="1.2" />
    </svg>
  );
}

/** Recent errors tab — a warning triangle. */
export function AlertIcon({ size = 16 }: IconProps) {
  return (
    <svg {...LINE_ICON} width={size} height={size}>
      <path d="M12 4 21 19.5H3Z" />
      <path d="M12 10v4.2" />
      <circle cx="12" cy="17" r="0.6" />
    </svg>
  );
}

/** Recent errors row toggle — a right-pointing chevron; CSS turns it down when the row is open. */
export function ChevronIcon({ size = 14 }: IconProps) {
  return (
    <svg {...LINE_ICON} width={size} height={size}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/** Recent errors Copy button — two stacked sheets. */
export function CopyIcon({ size = 14 }: IconProps) {
  return (
    <svg {...LINE_ICON} width={size} height={size}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </svg>
  );
}

/** Recent errors Copy button, just after a successful copy — a check mark. */
export function CheckIcon({ size = 14 }: IconProps) {
  return (
    <svg {...LINE_ICON} width={size} height={size}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}
