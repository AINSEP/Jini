import type { MediaProviderOption } from "@jini-ai/core";
import type { useEffect as UseEffect, useState as UseState } from "react";


/**
 * The host's live provider catalog for the External Providers tab: the SAME array its cards map
 * from and its count badge measures, so the two can never disagree. `null` while loading or when
 * the host was unreachable — the screen then shows no count rather than a made-up one.
 *
 * Fetched once per mount: the catalog is the host's mounted vendor set, which changes only when a
 * provider plugin is (un)mounted, not while an operator is on this screen.
 *
 * @complexity O(1) per render plus one request per mount.
 */
export function useMediaProviderCatalog(
  { port, useEffect, useState }: { useEffect: typeof UseEffect; useState: typeof UseState; port: { fetchMediaProviderCatalog: () => Promise<readonly MediaProviderOption[] | null> } },
  _optional: Record<string, never> = {},
): readonly MediaProviderOption[] | null {
  const [catalog, setCatalog] = useState<readonly MediaProviderOption[] | null>(null);
  useEffect(() => {
    let current = true;
    void port.fetchMediaProviderCatalog().then((next) => {
      if (current) setCatalog(next);
    });
    return () => {
      current = false;
    };
  }, [port]);
  return catalog;
}
