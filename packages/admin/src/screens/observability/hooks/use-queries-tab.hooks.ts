import { useFetchQuery } from "../../../react/kit.js";

export interface QueriesIdentityPort {
  me(): Promise<{ effectivePermissions?: readonly string[] }>;
}
export interface QueriesTabController {
  visible: boolean;
  readOnly: boolean;
}

/** Gate cache inspection on the host adapter and the server's owner wildcard.
 * Unknown/failed identity stays hidden. Built-in hosts never request identity for tooling.
 * @param required Host adapter and identity port; no vendor imports.
 * @param optional Development enables interactive tools; production is view-only.
 * @returns Tab visibility and interaction policy. Query errors keep the tab hidden.
 * @complexity O(p) for p effective permission strings; one cached identity read.
 */
export function useQueriesTab(
  { adapter, port }: { adapter: "tanstack" | "builtin" | null; port: QueriesIdentityPort },
  { development = false }: { development?: boolean } = {},
): QueriesTabController {
  const identity = useFetchQuery(
    { key: ["auth", "me"], fetch: () => port.me() },
    { enabled: adapter === "tanstack", staleTime: 0 },
  );
  return {
    // The identity service defines owners as unconstrained wildcard holders.
    visible: adapter === "tanstack" && identity.status === "success" && identity.error === null && identity.data?.effectivePermissions?.includes("*") === true,
    readOnly: !development,
  };
}
