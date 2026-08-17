/**
 * Public barrel for the preview-modal-shell slice. Consumers import ONLY
 * from here — never from an internal file directly.
 */
export type {
  PreviewModalContentStatus,
  PreviewModalPrimaryAction,
  PreviewModalPrimaryActionMenuItem,
  PreviewModalScalerStyle,
  PreviewModalUnavailable,
} from './types.js';

export {
  computeScalerStyle,
  computeStageScale,
  deriveContentStatus,
  findActiveView,
  resolveInitialViewId,
  type PreviewModalContentViewLike,
  type PreviewModalViewLike,
} from './rules.js';

export {
  usePreviewModalShell,
  type PreviewModalShellController,
  type UsePreviewModalShellOptions,
} from './react/hooks/usePreviewModalShell.js';

export {
  PreviewModalShell,
  type PreviewModalShellProps,
  type PreviewModalSidebar,
  type PreviewModalView,
} from './react/components/PreviewModalShell.js';

export { DEFAULT_PREVIEW_MODAL_ICONS, type PreviewModalIconName } from './react/components/icons.js';
