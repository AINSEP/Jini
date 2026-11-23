import { createContext, useContext } from "react";

/** The host's authenticated boot boundary; cache ownership stays with FetchQueryProvider.
 * Standalone panels can read immediately; App defers private reads until its session settles. */
export const AdminBootScopeContext = createContext<{ principalId: string | null; checking: boolean }>({ principalId: null, checking: false });

/** Identity for principal-specific query keys and the boot read gate. O(1), no I/O or store.
 * @example const { principalId, checking } = useAdminBootScope(); */
export function useAdminBootScope(_required = {}, _optional = {}) {
  const scope = useContext(AdminBootScopeContext);
  return { ...scope, queryScope: scope.principalId === null ? "anonymous" : `principal:${scope.principalId}` };
}
