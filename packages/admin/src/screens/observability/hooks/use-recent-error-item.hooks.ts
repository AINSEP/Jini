import { useCallback, useId, useState } from "react";
import { useCopyToClipboard } from "../../../react/kit.js";

import type { RecentErrorItemController, RecentErrorItemDependencies } from "../recent-errors-panel.js";

/**
 * @file State for ONE row of the Recent errors list: whether its full message is shown, and its
 * Copy button's "Copied" feedback (Jini's `useCopyToClipboard`, the same 1.5s flip every viewer
 * copy button uses). Each row owns its own state, so opening one row never re-renders the rest.
 */

export function useRecentErrorItem({ copyText, clipboard }: RecentErrorItemDependencies): RecentErrorItemController {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const { copied, copy: copyToClipboard } = useCopyToClipboard(clipboard);

  const toggle = useCallback(() => setExpanded((open) => !open), []);
  const copy = useCallback(() => copyToClipboard(copyText), [copyToClipboard, copyText]);

  return { expanded, toggle, detailId, copied, copy };
}
