import { autoFocusCancelForLifecycleOp, lifecycleCopy, type LifecycleConfirmOp } from "../rules.js";
import type { CollectionsHostKit } from "../collections-host-kit.js";

/**
 * @file `LifecycleConfirmDialog`'s op-derived copy/focus decision — native cancellation and
 * focus lifecycle now belong to Jini, so the dialog in `Collections.tsx` is only markup. This dialog holds no state
 * of its own; both derivations move to `rules.ts` (`LIFECYCLE_COPY`, `autoFocusCancelForLifecycleOp`)
 * since they compute a value from `op`, not just render one.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because
 * nothing outside `features/collections` needs it.
 */

export interface LifecycleConfirmDialogController {
  copy: { title: string; body: string };
  autoFocusCancel: boolean;
}

export interface LifecycleConfirmDialogDependencies {
  /** The resolved admin locale the host reads. */
  locale: string;
  /** The host's collections dictionary — see `collections-host-kit.ts`. */
  kit: CollectionsHostKit;
}

export function useLifecycleConfirmDialog(
  { props, locale, kit }: {
    props: {
      op: LifecycleConfirmOp;
      onCancel: () => void;
    };
  } & LifecycleConfirmDialogDependencies,
  _optional: Record<string, never> = {},
): LifecycleConfirmDialogController {
  return {
    copy: lifecycleCopy({ op: props.op, kit }, { locale }),
    autoFocusCancel: autoFocusCancelForLifecycleOp(props.op),
  };
}
