import { useEffect, useState, type CSSProperties } from "react";

/**
 * @file The Desktop/Tablet/Mobile device-width preview shared by every admin editor that previews a
 * rendered document: `PageEditor.tsx`, `ThemeExplore.tsx` and `PostEditor.tsx` (2026-09-22 — the
 * three used to carry their own copies of the toggle, the scaling frame and the pane measurement;
 * Posts had none at all). `DevicePreviewToggle.tsx` and `DevicePreviewFrame.tsx` render; everything
 * they derive lives here, per this repo's `<Name>.tsx`/`<Name>.hooks.ts` split.
 */

/**
 * Viewport widths the preview renders AT, independent of how much room the pane actually has.
 *
 * This is the point of the whole preview mechanism, not a nice-to-have. With the assistant dock
 * open the editor pane is well under half the window, so a preview rendered at its container's real
 * width would show a layout at ~900px that ships at 1280+ — the operator would be judging, and
 * asking the model to fix, breakpoints nobody will ever see. The document is rendered at the chosen
 * width and scaled down to fit instead.
 */
export const DEVICE_PREVIEW_WIDTHS = { desktop: 1280, tablet: 834, mobile: 390 } as const;

export type DevicePreviewDevice = keyof typeof DEVICE_PREVIEW_WIDTHS;

/** The toggle's buttons, in display order. `label` is the untranslated key the caller's `t()` reads. */
export const DEVICE_PREVIEW_OPTIONS: ReadonlyArray<{ key: DevicePreviewDevice; label: string }> = [
  { key: "desktop", label: "Desktop" },
  { key: "tablet", label: "Tablet" },
  { key: "mobile", label: "Mobile" },
];

/** The unscaled viewport height every preview renders at before it is scaled to fit the pane. */
export const DEVICE_PREVIEW_HEIGHT = 900;

/** The pane width assumed before the first real measurement lands — keeps the first paint's scale
 *  sane instead of `Infinity`/`NaN` from a zero-width frame. */
export const DEVICE_PREVIEW_DEFAULT_PANE_WIDTH = 880;

/**
 * The factor a `width`-px document is scaled by to fit a `paneWidth`-px pane: never above 1 (a
 * narrow Mobile preview in a wide pane renders 1:1, not blown up), and floored above zero. The floor
 * matters for the expanded frame: a zero-width observation (the frame measured during a paint where
 * its column has no width yet) would make its scaler height `calc(100% / 0)` — an INVALID
 * declaration CSS drops entirely, silently reverting the height to `auto`. No real measurement gets
 * anywhere near it.
 *
 * @complexity O(1).
 */
export function devicePreviewScale({ paneWidth, width }: { paneWidth: number; width: number }): number {
  return Math.max(0.01, Math.min(1, paneWidth / width));
}

/**
 * Inline styles for `DevicePreviewFrame`'s two boxes. Collapsed, the frame is a fixed
 * `900 * scale` box and the scaler the literal `900px`. Expanded, the frame gets NO inline height —
 * it takes its height from the fullscreen panel's flex column (`.page-preview-expanded
 * .page-preview-frame` / `.post-preview-expanded .page-preview-frame`), and an inline height would
 * beat that rule — and the scaler's `calc(100% / scale)` renders, after `scale(scale)`, exactly as
 * tall as the frame, so the previewed viewport grows with the panel.
 *
 * @complexity O(1).
 */
export function devicePreviewFrameStyles({
  paneWidth,
  width,
  expanded,
}: {
  paneWidth: number;
  width: number;
  expanded: boolean;
}): { frame: CSSProperties | undefined; scaler: CSSProperties } {
  const scale = devicePreviewScale({ paneWidth, width });
  return {
    frame: expanded ? undefined : { height: `${DEVICE_PREVIEW_HEIGHT * scale}px` },
    scaler: {
      width: `${width}px`,
      height: expanded ? `calc(100% / ${scale})` : `${DEVICE_PREVIEW_HEIGHT}px`,
      transform: `scale(${scale})`,
    },
  };
}

/**
 * The `agentHandle()` spread for one toggle button, or nothing when the caller gave no handle
 * prefix. With a prefix, the handle is `${prefix}-${key}` (e.g. `page-preview-width-mobile`).
 *
 * @complexity O(1).
 */
export function devicePreviewButtonHandleProps(
  { handlePrefix, entry, agentHandle }: {
    handlePrefix: string | undefined;
    entry: { key: DevicePreviewDevice; label: string };
    /** The host's handle builder (core `agentHandle`); its spread props go straight onto the button. */
    agentHandle: (required: { handle: string }, meta: { role: "button"; label: string }) => Readonly<Record<string, string>>;
  },
  _options: Record<string, never> = {},
) {
  if (!handlePrefix) return {};
  return agentHandle({ handle: `${handlePrefix}-${entry.key}` }, { role: "button", label: `Preview at ${entry.label} width` });
}

/** Same 640px phone breakpoint as `styles.css`'s phone rules (card tables, swipeable tabs). */
const PHONE_VIEWPORT_QUERY = "(max-width: 640px)";

function matchesPhoneViewport(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(PHONE_VIEWPORT_QUERY).matches;
}

/**
 * The device a preview opens at when its caller names none: Mobile on a phone, Desktop otherwise.
 * On a 375px phone a 1280px preview scales by ~0.27 and its body text lands near 4px — unreadable
 * (mobile catalog P-7/PG-4/TH-4, 2026-10-06); the phone's own width is the useful first view there.
 *
 * @complexity O(1).
 */
export function defaultDevicePreviewDevice({ isPhone }: { isPhone: boolean }): DevicePreviewDevice {
  return isPhone ? "mobile" : "desktop";
}

/**
 * The selected device plus its pixel width. View state only; the viewport check is read once, on
 * mount, so rotating or resizing later never overrides a device the operator picked.
 *
 * @param initial - The device to open at. @default Mobile on a phone viewport, else Desktop
 * @param optional.isPhone - Whether the viewport is phone-width. @default matchMedia (640px)
 * @complexity O(1).
 */
export function useDevicePreviewDevice(
  initial?: DevicePreviewDevice,
  { isPhone = matchesPhoneViewport }: { readonly isPhone?: () => boolean } = {},
): {
  device: DevicePreviewDevice;
  setDevice: (value: DevicePreviewDevice) => void;
  width: number;
} {
  const [device, setDevice] = useState<DevicePreviewDevice>(() => initial ?? defaultDevicePreviewDevice({ isPhone: isPhone() }));
  return { device, setDevice, width: DEVICE_PREVIEW_WIDTHS[device] };
}

/**
 * The preview frame's REAL rendered width, measured live via `ResizeObserver` rather than a guessed
 * constant — a flat `880` meant the scale computed once and stayed frozen across a window resize, a
 * sidebar collapse, or the assistant dock opening/closing.
 *
 * `frameRef` is a CALLBACK ref (a piece of state plus its setter), NOT a `useRef`, and the effect is
 * keyed off the NODE itself. A `useRef` has no way to notify anything when React attaches a node, so
 * an effect keyed on anything else can run before the frame exists (e.g. while the editor still
 * shows its loading notice), find `null`, bail, and never run again — measured live on a real page:
 * a 1131px pane rendering at the `880/1280` scale. React calls a callback ref exactly when the node
 * mounts, however late, and with `null` on unmount, so every mount gets a fresh observer and every
 * unmount disconnects it.
 *
 * jsdom implements no `ResizeObserver` (`__tests__/setup.ts` deliberately leaves it unstubbed), so the
 * guard below keeps every unit test rendering at the `880` default.
 *
 * @returns The callback ref to attach and the frame's last-measured width.
 * @complexity O(1) per resize callback — one observed element, at most one entry.
 */
export function usePreviewPaneWidth(): {
  frameRef: (node: HTMLDivElement | null) => void;
  paneWidth: number;
} {
  const [frameNode, setFrameNode] = useState<HTMLDivElement | null>(null);
  const [paneWidth, setPaneWidth] = useState<number>(DEVICE_PREVIEW_DEFAULT_PANE_WIDTH);
  useEffect(() => {
    if (!frameNode || typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setPaneWidth(entry.contentRect.width);
    });
    observer.observe(frameNode);
    return () => observer.disconnect();
  }, [frameNode]);
  return { frameRef: setFrameNode, paneWidth };
}
