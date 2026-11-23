import { RemixIcon } from "../../../react/kit.js";

/**
 * @file Icon overrides for the `PreviewModalShell` around the read-only code viewers (plugin
 * package files, theme templates). Only the exit-fullscreen glyph: Jini's default draws a tiny
 * closed triangle in each corner that read as a speck once expanded (owner screenshot,
 * 2026-10-15). RemixIcon's inward diagonal arrows mirror the default expand glyph, so the docked
 * view is unchanged.
 */
export const CODE_PREVIEW_MODAL_ICONS = {
  "fullscreen-exit": () => <RemixIcon name="collapse-diagonal-line" size={16} />,
};
