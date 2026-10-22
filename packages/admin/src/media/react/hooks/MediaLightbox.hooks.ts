import type { MediaAsset } from '../../models.js';
import type { MediaApiPort } from '../../ports.js';
export interface MediaLightboxProps {
  readonly items: readonly MediaAsset[];
  readonly api: MediaApiPort;
  readonly activeIndex: number | null;
  readonly onNavigate: (index: number) => void;
  readonly onClose: () => void;
}
/** Resolves the open asset and the shared lightbox's set props. Clamping, keyboard, focus and
 * the open/close lifecycle live in `@jini-ai/ui`'s `useLightbox`. */
export function useMediaLightbox(props: MediaLightboxProps, _optional: Record<string, never> = {}) {
  const item = props.activeIndex === null ? null : props.items[props.activeIndex] ?? null;
  return {
    item,
    lightbox: {
      open: !!item,
      title: item?.title ?? '',
      index: props.activeIndex ?? 0,
      count: props.items.length,
      onNavigate: props.onNavigate,
      onClose: props.onClose,
    },
  };
}
