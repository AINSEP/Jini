import { useCallback, useId, useState } from "react";
import type { AdminKitHooks } from "../../../react/kit.js";

import type { RecentErrorItemController, RecentErrorItemDependencies } from "../recent-errors-panel.js";

/**
 * @file State for ONE row of the Recent errors list: whether its full message is shown, and its
 * Copy button's "Copied" feedback (the injected `useCopyToClipboardHook`, the same 1.5s flip every viewer
 * copy button uses). Each row owns its own state, so opening one row never re-renders the rest.
 */

/** The row's dependencies plus the host's copy hook (the UI library's, bound in the host's kit). */
export type RecentErrorItemArgs = RecentErrorItemDependencies & { useCopyToClipboardHook: AdminKitHooks["useCopyToClipboard"] };

export function useRecentErrorItem({ copyText, clipboard, useCopyToClipboardHook }: RecentErrorItemArgs, _optional: Record<string, never> = {}): RecentErrorItemController {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const { copied, copy: copyToClipboard } = useCopyToClipboardHook(clipboard);

  const toggle = useCallback(() => setExpanded((open) => !open), []);
  const copy = useCallback(() => copyToClipboard(copyText), [copyToClipboard, copyText]);

  return { expanded, toggle, detailId, copied, copy };
}
