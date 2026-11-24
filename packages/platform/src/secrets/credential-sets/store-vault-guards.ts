import type { KeyringPort } from "@jini-ai/core/contracts/vault";

/** The parts of a store vault's `required` input that crypto guards read. Both are read at call time,
 * never captured, so a guard always sees the store's current keyring and translator. */
export interface StorageFailureSource {
  keyring?: KeyringPort;
  storageError: (required: {}, options?: { error?: unknown }) => Error;
}

/** Only crypto errors become the feature's safe storage error; the original error is its argument.
 * @throws whatever `source.storageError` returns, for any sync or async failure of `operation`.
 * @complexity O(1) around one awaited operation.
 */
export async function protectStorage<T>(
  { operation, source }: { operation: () => Promise<T>; source: Pick<StorageFailureSource, "storageError"> },
  _optional = {},
): Promise<T> {
  try { return await operation(); } catch (error) { throw source.storageError({}, { error }); }
}

/** Keyring port for a store vault. A missing keyring raises the storage error inside the guard, which
 * then translates it once more, passing the first storage error back to the translator. Jini's vault
 * service calls only `activeKey`; `derive` and `deriveSigningSecret` complete the port contract.
 * @complexity O(1) per call; delegates all key work to the injected keyring.
 */
export function createStoreKeyring({ source }: { source: StorageFailureSource }, _optional = {}): KeyringPort {
  const withKeyring = <T>({ use }: { use: ({ keyring }: { keyring: KeyringPort }, optional?: Record<string, never>) => Promise<T> }): Promise<T> => protectStorage({ source, operation: () => {
    if (!source.keyring) throw source.storageError({});
    return use({ keyring: source.keyring });
  } });
  return {
    derive: input => withKeyring({ use: ({ keyring }) => keyring.derive(input) }),
    deriveSigningSecret: input => withKeyring({ use: ({ keyring }) => keyring.deriveSigningSecret(input) }),
    activeKey: () => withKeyring({ use: ({ keyring }) => keyring.activeKey({}) }),
  };
}
