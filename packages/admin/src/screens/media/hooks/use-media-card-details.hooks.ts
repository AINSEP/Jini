import { useEffect, useState } from "react";

const PHONE_QUERY = "(max-width: 640px)";
const matchViewport = (query: string) =>
  typeof window === "undefined" ? undefined : window.matchMedia?.(query);

/** Phone card bodies share the existing metadata action. Preview/play and row-menu controls
 * remain independent; a real title button supplies keyboard access and the CSS stretches its hit area.
 * `Item` is the host's media item, passed through untouched to the host's own edit action.
 */
export function useMediaCardDetails<Item>(
  { onToggleEdit }: { onToggleEdit: (item: Item) => void },
  { matchMedia = matchViewport }: { matchMedia?: (query: string) => MediaQueryList | undefined } = {},
) {
  // Viewport detection enhances the desktop card; an unavailable query must not block the grid.
  const [isPhone, setIsPhone] = useState(() => matchMedia(PHONE_QUERY)?.matches ?? false);
  useEffect(() => {
    const query = matchMedia(PHONE_QUERY);
    const update = () => setIsPhone(query?.matches ?? false);
    update();
    if (!query) return undefined;
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [matchMedia]);
  return { isPhone, openDetails: onToggleEdit };
}
