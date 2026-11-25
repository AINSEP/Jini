/**
 * A host-owned private temp root, held for the whole of `work`: the host creates it (typically lock,
 * then marker, then folder), keeps it owned while `work` reads and writes inside it, and removes it
 * afterwards. Injected so the host's temp-root tidy can sweep the same parent without ever seeing a
 * live root as abandoned. The engine never chooses a temp parent or lock for an injected scope.
 */
export type OwnedTempRootScope = <T>(required: { work: (owned: { root: string }) => Promise<T> }) => Promise<T>;
