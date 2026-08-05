// NOTE: verified zero real consumers in the vendored source snapshot before
// porting (see packages/ui/source-map.md) — shipped anyway since it's small,
// self-contained, and correct.
//
// Structure follows the "dumb component + co-located testable hook(s)"
// pattern (see TooltipLayer.tsx): pure derivations are module-level helpers,
// all state/effects/callbacks live in exported hooks, and `PaletteTweaks`
// itself is a pure render. Everything is exported so each seam is unit- or
// hook-testable in isolation.

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Icon } from './Icon.js';

export type PaletteId =
  | 'coral'
  | 'electric'
  | 'acid-forest'
  | 'risograph'
  | 'mono-noir';

/** A hover target inside the picker: a palette, the "original" row, or none. */
export type PaletteHoverTarget = PaletteId | 'original' | null;

export interface PaletteSwatch {
  id: PaletteId;
  label: string;
  stripe: string[];
}

export const PALETTE_TWEAKS_SWATCHES: PaletteSwatch[] = [
  { id: 'coral',       label: 'Coral - default', stripe: ['#ff5a3c', '#ff7a5c', '#fde2d6', '#171717'] },
  { id: 'electric',    label: 'Electric',        stripe: ['#7c3aed', '#a855f7', '#e9d5ff', '#171717'] },
  { id: 'acid-forest', label: 'Acid forest',     stripe: ['#16a34a', '#22c55e', '#bbf7d0', '#0f1d14'] },
  { id: 'risograph',   label: 'Risograph',       stripe: ['#e11d48', '#2563eb', '#fde68a', '#171717'] },
  { id: 'mono-noir',   label: 'Mono noir',       stripe: ['#0a0a0a', '#262626', '#e5e5e5', '#fafafa'] },
];

export interface PaletteTweaksProps {
  open: boolean;
  selected: PaletteId | null;
  onChange: (id: PaletteId | null) => void;
  onPreview: (id: PaletteId | null) => void;
  onClose: () => void;
}

// --- Pure derivations (module-level, directly unit-testable) --------------

/**
 * The palette to preview for a given hover target: the "original" row previews
 * nothing (`null`), leaving the row (target `null`) restores the current
 * `selected` preview, and hovering a palette previews that palette.
 */
export function resolvePalettePreview(
  target: PaletteHoverTarget,
  selected: PaletteId | null,
): PaletteId | null {
  if (target === 'original') return null;
  if (target === null) return selected;
  return target;
}

/**
 * The next selection when a palette row is clicked: clicking the already
 * selected palette deselects it (back to `null`), otherwise it selects it.
 */
export function nextPaletteSelection(
  selected: PaletteId | null,
  id: PaletteId,
): PaletteId | null {
  return selected === id ? null : id;
}

/** The `className` for a picker row, given its selected/hovered state. */
export function paletteItemClassName(state: {
  selected: boolean;
  hovered: boolean;
}): string {
  return `palette-tweaks-item${state.selected ? ' selected' : ''}${state.hovered ? ' hovered' : ''}`;
}

// --- Hooks (co-located, exported) -----------------------------------------

export interface UsePaletteHoverResult {
  /** The currently hovered target, or `null` when nothing is hovered. */
  hovered: PaletteHoverTarget;
  /** Set the hovered target and emit the corresponding preview. */
  setHover: (target: PaletteHoverTarget) => void;
}

/**
 * Owns the picker's hover state and the preview side effect. Setting a hover
 * target emits the resolved preview; closing the picker (`open` -> false)
 * clears the hover and cancels any active preview.
 */
export function usePaletteHover(options: {
  open: boolean;
  selected: PaletteId | null;
  onPreview: (id: PaletteId | null) => void;
}): UsePaletteHoverResult {
  const { open, selected, onPreview } = options;
  const [hovered, setHovered] = useState<PaletteHoverTarget>(null);

  const setHover = useCallback(
    (target: PaletteHoverTarget) => {
      setHovered(target);
      onPreview(resolvePalettePreview(target, selected));
    },
    [onPreview, selected],
  );

  useEffect(() => {
    if (!open) {
      setHovered(null);
      onPreview(null);
    }
  }, [open, onPreview]);

  return { hovered, setHover };
}

/**
 * Wires up dismiss behavior while the picker is `open`: a `mousedown` outside
 * the returned `rootRef` element, or pressing `Escape`, calls `onClose`.
 * Returns the ref to attach to the picker's root element.
 */
export function usePaletteDismiss(options: {
  open: boolean;
  onClose: () => void;
}): MutableRefObject<HTMLDivElement | null> {
  const { open, onClose } = options;
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(ev: MouseEvent) {
      if (!rootRef.current) return;
      if (rootRef.current.contains(ev.target as Node)) return;
      onClose();
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return rootRef;
}

// --- Dumb component --------------------------------------------------------

/**
 * Curated theme-palette picker. All state/effects live in
 * {@link usePaletteHover} and {@link usePaletteDismiss}; the row derivations
 * are module-level helpers. This component is a pure render.
 */
export function PaletteTweaks({ open, selected, onChange, onPreview, onClose }: PaletteTweaksProps) {
  const rootRef = usePaletteDismiss({ open, onClose });
  const { hovered, setHover } = usePaletteHover({ open, selected, onPreview });

  if (!open) return null;
  const isOriginal = selected === null;

  return (
    <div className="palette-tweaks" ref={rootRef} role="dialog" aria-label="Themes">
      <div className="palette-tweaks-header">
        <span className="palette-tweaks-title">Themes</span>
        <span className="palette-tweaks-sub">5 curated theme palettes</span>
      </div>
      <ul className="palette-tweaks-list" role="listbox">
        <li
          role="option"
          aria-selected={isOriginal}
          className={paletteItemClassName({ selected: isOriginal, hovered: hovered === 'original' })}
          onMouseEnter={() => setHover('original')}
          onMouseLeave={() => setHover(null)}
          onClick={() => { onChange(null); onClose(); }}
        >
          <span className="palette-tweaks-stripe palette-tweaks-stripe-original" aria-hidden>
            <span className="palette-tweaks-chip palette-tweaks-chip-original" />
          </span>
          <span className="palette-tweaks-label">Original</span>
          {isOriginal ? (
            <span className="palette-tweaks-check" aria-hidden>
              <Icon name="check" size={12} />
            </span>
          ) : null}
        </li>
        {PALETTE_TWEAKS_SWATCHES.map((p) => {
          const isSelected = selected === p.id;
          const isHovered = hovered === p.id;
          return (
            <li
              key={p.id}
              role="option"
              aria-selected={isSelected}
              className={paletteItemClassName({ selected: isSelected, hovered: isHovered })}
              onMouseEnter={() => setHover(p.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => {
                onChange(nextPaletteSelection(selected, p.id));
                onClose();
              }}
            >
              <span className="palette-tweaks-stripe" aria-hidden>
                {p.stripe.map((c, i) => (
                  <span key={i} className="palette-tweaks-chip" style={{ backgroundColor: c }} />
                ))}
              </span>
              <span className="palette-tweaks-label">{p.label}</span>
              {isSelected ? (
                <span className="palette-tweaks-check" aria-hidden>
                  <Icon name="check" size={12} />
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
