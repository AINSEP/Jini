/**
 * @file Where the sites home window's size and position are remembered, and the decision that
 * keeps a remembered spot from ever opening the window off-screen.
 *
 * Electron does not persist `BrowserWindow` geometry on its own — every launch starts at whatever
 * fixed size the constructor names unless something writes it down and reads it back. This is that
 * something: a JSON file in `userData` (same convention as `site-dir-store.ts`'s
 * `desktop-state.json` and `site-child-registry.ts`'s `site-processes/` files, both resolved the same way from
 * `app.getPath("userData")`), plus {@link resolveWindowBounds} — the one place that decides whether
 * a remembered rectangle is still worth trusting.
 *
 * **Why a display can make a remembered spot wrong.** A laptop undocked from an external monitor,
 * or a monitor unplugged outright, leaves yesterday's `(x, y)` pointing at empty space no display
 * now covers — Electron does not clamp this itself; the window opens exactly there, invisible and
 * unreachable except from the Window menu. {@link boundsOnScreen} is the guard: a remembered
 * rectangle is trusted only when it meaningfully overlaps some CURRENT display, checked fresh at
 * every launch rather than assumed from whenever it was saved.
 *
 * No `electron` import, so all of it is testable under plain `node --test`; `main.ts` supplies the
 * `userData` path and `screen.getAllDisplays()`.
 */
// Geometry rationale: Jini packages/desktop-host/src/electron/usability/window-bounds-store.ts.
import fs from "node:fs";
import path from "node:path";
import {
  windowBoundsFilePath as boundsFilePath, readWindowBounds as readBounds,
  writeWindowBounds as writeBounds, resolveWindowBounds as resolveBounds, boundsOnScreen as onScreen,
  type BoundsStorePort, type WindowBounds, type DisplayLike, type ResolveWindowBoundsInput,
} from "../electron/usability/index.js";
export type { WindowBounds, DisplayLike, ResolveWindowBoundsInput } from "../electron/usability/index.js";
const store: BoundsStorePort = {
  read: ({ key }) => JSON.parse(fs.readFileSync(key, "utf8")),
  write: ({ key, bounds }) => {
    fs.mkdirSync(path.dirname(key), { recursive: true });
    fs.writeFileSync(key, JSON.stringify(bounds, null, 2));
  },
};
/** Resolve the host's state filename. @complexity O(1). */
export function windowBoundsFilePath({ userDataDir }: { userDataDir: string }): string {
  return boundsFilePath({ userDataDir, fileName: "window-bounds.json", joinPath: ({ directory, filename }) => path.join(directory, filename) });
}
/**
 * Read persisted bounds; missing, unreadable, malformed or non-finite entries mean nothing
 * remembered yet. The caller's fixed-size, centered fallback is safe, so corrupt cache data
 * must degrade to that rather than crash startup.
 * @complexity O(n) in file bytes.
 */
export function readWindowBounds({ boundsPath }: { boundsPath: string }): WindowBounds | null {
  return readBounds({ store, key: boundsPath });
}
/** Write host JSON; filesystem errors propagate. @complexity O(1). */
export function writeWindowBounds({ boundsPath, bounds }: { boundsPath: string; bounds: WindowBounds }): void {
  writeBounds({ store, key: boundsPath, bounds });
}
/**
 * Require 100px of overlap in both dimensions: reject a stray visible sliver, yet allow a window
 * mostly dragged past a display edge. Use current displays rather than the list at save time.
 * @complexity O(n) in displays (at most a handful in practice).
 */
export function boundsOnScreen({ bounds, displays }: { bounds: WindowBounds; displays: readonly DisplayLike[] }): boolean {
  return onScreen({ bounds, displays }, { minOnscreenPx: 100 });
}
/**
 * Restore trusted geometry; otherwise omit x/y so Electron centers the default size on the
 * primary display. An unplugged monitor must not leave an unreachable window in empty space.
 * @complexity O(n) in displays.
 */
export function resolveWindowBounds(input: ResolveWindowBoundsInput): Partial<WindowBounds> {
  return resolveBounds(input, { minOnscreenPx: 100 });
}
