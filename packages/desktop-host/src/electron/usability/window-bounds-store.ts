/** Electron does not persist or clamp window geometry itself. A remembered position can point
 * into empty space after undocking or unplugging a display, leaving the window unreachable.
 * Validate meaningful overlap against the current display list on every launch, not the saved one. */
export interface WindowBounds { x: number; y: number; width: number; height: number }
export interface DisplayLike { bounds: WindowBounds }
export interface DisplayPort { getAllDisplays(): readonly DisplayLike[] }
export interface BoundsStorePort {
  read(args: { key: string }): unknown;
  write(args: { key: string; bounds: WindowBounds }): void;
}
/** Resolve a caller-owned filename without introducing a fixed persistence key. */
export function windowBoundsFilePath({ userDataDir, fileName, joinPath }: {
  userDataDir: string; fileName: string; joinPath: (args: { directory: string; filename: string }) => string;
}): string { return joinPath({ directory: userDataDir, filename: fileName }); }
/** Treat missing, unreadable or malformed persisted rectangles as absent. */
export function readWindowBounds({ store, key }: { store: BoundsStorePort; key: string }): WindowBounds | null {
  // Geometry is a cache: a corrupt or unreadable entry must degrade to the safe centered default,
  // not prevent application startup.
  try {
    const parsed = store.read({ key });
    if (parsed === null || typeof parsed !== "object") return null;
    const { x, y, width, height } = parsed as Partial<WindowBounds>;
    if (![x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    return { x: x as number, y: y as number, width: width as number, height: height as number };
  } catch { return null; }
}
/** Store geometry using the host's persistence adapter. Write failures propagate. */
export function writeWindowBounds({ store, key, bounds }: { store: BoundsStorePort; key: string; bounds: WindowBounds }): void {
  store.write({ key, bounds });
}
/** Require a meaningful overlap with at least one current display. */
export function boundsOnScreen({ bounds, displays }: { bounds: WindowBounds; displays: readonly DisplayLike[] }, { minOnscreenPx = 100 }: { minOnscreenPx?: number } = {}): boolean {
  // The 100px default rejects a stray visible sliver yet permits a window partly dragged off-screen.
  // Both dimensions must overlap enough for the remembered rectangle to be useful.
  return displays.some((display) => {
    const width = Math.min(bounds.x + bounds.width, display.bounds.x + display.bounds.width) - Math.max(bounds.x, display.bounds.x);
    const height = Math.min(bounds.y + bounds.height, display.bounds.y + display.bounds.height) - Math.max(bounds.y, display.bounds.y);
    return width >= minOnscreenPx && height >= minOnscreenPx;
  });
}
export interface ResolveWindowBoundsInput {
  stored: WindowBounds | null; displays: readonly DisplayLike[]; fallback: { width: number; height: number };
}
/** Restore visible geometry; omit position so the shell centers the safe fallback. */
export function resolveWindowBounds(input: ResolveWindowBoundsInput, options: { minOnscreenPx?: number } = {}): Partial<WindowBounds> {
  if (input.stored && boundsOnScreen({ bounds: input.stored, displays: input.displays }, options)) return input.stored;
  return { width: input.fallback.width, height: input.fallback.height };
}

/** Read stored geometry and current displays through the host's ports. */
export function restoreWindowBounds({ store, display, key, fallback }: {
  store: BoundsStorePort; display: DisplayPort; key: string; fallback: { width: number; height: number };
}, options: { minOnscreenPx?: number } = {}): Partial<WindowBounds> {
  return resolveWindowBounds({ stored: readWindowBounds({ store, key }), displays: display.getAllDisplays(), fallback }, options);
}
